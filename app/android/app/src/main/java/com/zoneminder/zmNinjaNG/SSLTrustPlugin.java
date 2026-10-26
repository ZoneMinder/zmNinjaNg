package com.zoneminder.zmNinjaNG;

import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.zoneminder.zmNinjaNG.stream.ZmFrameWebViewClient;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.net.Socket;
import java.net.URL;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLEngine;
import javax.net.ssl.SSLSession;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509ExtendedTrustManager;
import javax.net.ssl.X509TrustManager;

import android.net.http.SslCertificate;

@CapacitorPlugin(name = "SSLTrust")
public class SSLTrustPlugin extends Plugin {

    /**
     * The loaded plugin, so the WebView client can ask about a certificate without
     * holding a reference to it. One bridge means one instance; it is written once in
     * load() and never cleared.
     */
    private static volatile SSLTrustPlugin loaded;

    private volatile boolean enabled = false;
    private volatile Map<String, String> trustedFingerprints = new HashMap<>();
    private SSLSocketFactory originalSslSocketFactory;
    private HostnameVerifier originalHostnameVerifier;

    @Override
    public void load() {
        loaded = this;
        // Save originals so we can restore them on disable
        originalSslSocketFactory = HttpsURLConnection.getDefaultSSLSocketFactory();
        originalHostnameVerifier = HttpsURLConnection.getDefaultHostnameVerifier();
    }

    @PluginMethod
    public void enable(PluginCall call) {
        this.enabled = true;
        installFingerprintTrustManager();
        // WebView handler is only installed via setTrustedFingerprints()
        // so that onReceivedSslError never calls proceed() without validation
        call.resolve();
    }

    @PluginMethod
    public void disable(PluginCall call) {
        this.enabled = false;
        this.trustedFingerprints = new HashMap<>();
        restoreOriginalCerts();
        restoreWebViewSslHandler();
        call.resolve();
    }

    @PluginMethod
    public void isEnabled(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("enabled", this.enabled);
        call.resolve(ret);
    }

    @PluginMethod
    public void setTrustedFingerprints(PluginCall call) {
        JSArray entries = call.getArray("entries");
        Map<String, String> updated = new HashMap<>();
        if (entries != null) {
            for (int i = 0; i < entries.length(); i++) {
                try {
                    JSONObject entry = entries.getJSONObject(i);
                    updated.put(normalizeHost(entry.getString("host")), entry.getString("fingerprint"));
                } catch (JSONException e) {
                    // Skip malformed entry
                }
            }
        }
        // Rebuild atomically: a single assignment swaps the whole map at once
        this.trustedFingerprints = updated;
        if (this.enabled) {
            installFingerprintTrustManager();
            // Only install WebView handler when we have fingerprints to validate against.
            // This ensures onReceivedSslError never calls proceed() without cert validation.
            if (!updated.isEmpty()) {
                installWebViewSslHandler();
            } else {
                restoreWebViewSslHandler();
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void getServerCertFingerprint(PluginCall call) {
        String urlStr = call.getString("url");
        if (urlStr == null || urlStr.isEmpty()) {
            call.reject("URL is required");
            return;
        }

        new Thread(() -> {
            try {
                // Create a trust-all context for this one-time cert fetch
                TrustManager[] trustAll = new TrustManager[]{
                    new X509TrustManager() {
                        @Override
                        public void checkClientTrusted(X509Certificate[] chain, String authType) {}
                        @Override
                        public void checkServerTrusted(X509Certificate[] chain, String authType) {}
                        @Override
                        public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                    }
                };

                SSLContext tempContext = SSLContext.getInstance("TLS");
                tempContext.init(null, trustAll, new SecureRandom());

                URL url = new URL(urlStr);
                HttpsURLConnection conn = (HttpsURLConnection) url.openConnection();
                conn.setSSLSocketFactory(tempContext.getSocketFactory());
                conn.setHostnameVerifier((hostname, session) -> true);
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);
                conn.connect();

                java.security.cert.Certificate[] certs = conn.getServerCertificates();
                conn.disconnect();

                if (certs.length == 0) {
                    call.reject("No certificates returned by server");
                    return;
                }

                X509Certificate cert = (X509Certificate) certs[0];
                String fingerprint = sha256Fingerprint(cert);

                JSObject ret = new JSObject();
                ret.put("fingerprint", fingerprint);
                ret.put("subject", cert.getSubjectX500Principal().getName());
                ret.put("issuer", cert.getIssuerX500Principal().getName());
                ret.put("expiry", cert.getNotAfter().toString());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to get server certificate: " + e.getMessage(), e);
            }
        }).start();
    }

    /**
     * Resolve the platform default X509TrustManager (system CA store), or null if
     * unavailable. Used so the pinned trust manager can still accept normally-valid
     * certificates from other hosts.
     */
    private X509TrustManager getSystemTrustManager() {
        try {
            TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
            tmf.init((KeyStore) null);
            for (TrustManager tm : tmf.getTrustManagers()) {
                if (tm instanceof X509TrustManager) {
                    return (X509TrustManager) tm;
                }
            }
        } catch (Exception e) {
            // Fall back to fingerprint-only behavior.
        }
        return null;
    }

    /**
     * Install a TrustManager used while self-signed trust is enabled. A certificate
     * is accepted if it passes normal system validation (valid CA certs, other
     * servers) OR matches the pinned fingerprint for the connection's host (the
     * user's self-signed cert), so a pinned fingerprint does not reject every other
     * HTTPS host. With no fingerprint pinned yet for a host, self-signed certs are
     * accepted for the TOFU cert-fetch flow. This covers CapacitorHttp requests
     * which use HttpsURLConnection/OkHttp. X509ExtendedTrustManager is used (API 24+,
     * matching minSdkVersion) so the socket/engine handshake exposes the peer host.
     */
    private void installFingerprintTrustManager() {
        try {
            final X509TrustManager systemTrustManager = getSystemTrustManager();
            TrustManager[] trustManagers = new TrustManager[]{
                new X509ExtendedTrustManager() {
                    @Override
                    public void checkClientTrusted(X509Certificate[] chain, String authType) {}

                    @Override
                    public void checkClientTrusted(X509Certificate[] chain, String authType, Socket socket) {}

                    @Override
                    public void checkClientTrusted(X509Certificate[] chain, String authType, SSLEngine engine) {}

                    @Override
                    public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                        checkServerTrustedForHost(chain, authType, systemTrustManager, null);
                    }

                    @Override
                    public void checkServerTrusted(X509Certificate[] chain, String authType, Socket socket) throws CertificateException {
                        String host = null;
                        if (socket instanceof SSLSocket) {
                            try {
                                SSLSession handshakeSession = ((SSLSocket) socket).getHandshakeSession();
                                if (handshakeSession != null) {
                                    host = handshakeSession.getPeerHost();
                                }
                            } catch (Exception e) {
                                // host stays null; treated as no pinned entry below
                            }
                        }
                        checkServerTrustedForHost(chain, authType, systemTrustManager, host);
                    }

                    @Override
                    public void checkServerTrusted(X509Certificate[] chain, String authType, SSLEngine engine) throws CertificateException {
                        checkServerTrustedForHost(chain, authType, systemTrustManager, engine.getPeerHost());
                    }

                    @Override
                    public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                }
            };

            SSLContext sslContext = SSLContext.getInstance("TLS");
            sslContext.init(null, trustManagers, new SecureRandom());
            HttpsURLConnection.setDefaultSSLSocketFactory(sslContext.getSocketFactory());
            HttpsURLConnection.setDefaultHostnameVerifier(new HostnameVerifier() {
                @Override
                public boolean verify(String hostname, SSLSession session) {
                    // Hostname check is relaxed for self-signed certs (they typically
                    // don't have SANs matching the hostname)
                    return enabled;
                }
            });
        } catch (Exception e) {
            // Log but don't crash
        }
    }

    /**
     * Validate a server certificate chain against the pinned fingerprint for the
     * given host. Accepts certs that pass normal system validation first, so a
     * pinned self-signed fingerprint does not reject valid-CA servers. With no
     * fingerprint pinned for this host, self-signed certs are accepted (TOFU) so
     * the app can fetch the cert and show the trust dialog.
     */
    private void checkServerTrustedForHost(
            X509Certificate[] chain,
            String authType,
            X509TrustManager systemTrustManager,
            String host
    ) throws CertificateException {
        if (systemTrustManager != null) {
            try {
                systemTrustManager.checkServerTrusted(chain, authType);
                return;
            } catch (CertificateException notSystemValid) {
                // Not CA-valid (likely self-signed). Fall through to the
                // fingerprint check below.
            }
        }
        String fp = (host != null) ? trustedFingerprints.get(normalizeHost(host)) : null;
        if (fp == null || fp.isEmpty()) {
            // No fingerprint stored for this host yet — allow connection so the
            // app can fetch the cert and show the TOFU dialog
            return;
        }
        if (chain == null || chain.length == 0) {
            throw new CertificateException("No server certificate");
        }
        try {
            String actual = sha256Fingerprint(chain[0]);
            if (!actual.equals(fp)) {
                throw new CertificateException(
                    "Certificate fingerprint mismatch: expected " + fp + ", got " + actual
                );
            }
        } catch (CertificateException ce) {
            throw ce;
        } catch (Exception e) {
            throw new CertificateException("Fingerprint check failed", e);
        }
    }

    /**
     * Restore the original SSL socket factory and hostname verifier.
     */
    private void restoreOriginalCerts() {
        if (originalSslSocketFactory != null) {
            HttpsURLConnection.setDefaultSSLSocketFactory(originalSslSocketFactory);
        }
        if (originalHostnameVerifier != null) {
            HttpsURLConnection.setDefaultHostnameVerifier(originalHostnameVerifier);
        }
    }

    /**
     * Whether the WebView may proceed past an SSL error: self-signed trust is on and
     * the certificate matches the pinned fingerprint for its host, or that host has
     * no fingerprint yet, which is the TOFU case the dialog needs. Called by
     * {@link ZmFrameWebViewClient#onReceivedSslError}, which owns the WebView client
     * so that the zmframe:// interception cannot be swapped away.
     */
    public static boolean isWebViewCertTrusted(SslError error) {
        SSLTrustPlugin plugin = loaded;
        // The live flag, not the client's constructor flag: disable() clears this
        // before it swaps the client back, so the window in between still cancels.
        if (plugin == null || !plugin.enabled || error == null) return false;

        String host = Uri.parse(error.getUrl()).getHost();
        String fp = (host != null) ? plugin.trustedFingerprints.get(normalizeHost(host)) : null;
        if (fp == null || fp.isEmpty()) {
            // No fingerprint stored for this host yet — allow so the
            // app can fetch the cert and show the TOFU dialog
            return true;
        }
        // Validate the certificate fingerprint
        try {
            X509Certificate cert = extractX509(error.getCertificate());
            if (cert != null) {
                return sha256Fingerprint(cert).equals(fp);
            }
        } catch (Exception e) {
            // Fall through to reject
        }
        return false;
    }

    /**
     * Install the WebView client that validates SSL certificates against the trusted
     * fingerprint for the connection's host. This covers <img src="https://...">,
     * MJPEG streams, and WSS connections in the WebView.
     */
    private void installWebViewSslHandler() {
        setWebViewClient(true);
    }

    /**
     * Restore strict SSL (the WebView's own validation decides).
     */
    private void restoreWebViewSslHandler() {
        setWebViewClient(false);
    }

    /**
     * Both paths build a ZmFrameWebViewClient, never a bare BridgeWebViewClient: it
     * is the only client that serves zmframe://, and a toggle that installed anything
     * else would leave every native MJPEG tile with no frames.
     */
    private void setWebViewClient(boolean trustSelfSigned) {
        getActivity().runOnUiThread(() -> {
            try {
                getBridge().setWebViewClient(new ZmFrameWebViewClient(getBridge(), trustSelfSigned));
            } catch (Exception e) {
                // Ignore
            }
        });
    }

    /**
     * Normalize a host string for use as a trust-map key: lowercase (platform-
     * reported hosts may differ in case from the JS side's `new URL().hostname`),
     * and strip surrounding "[ ]" from IPv6 literals (JS stores them bracket-free).
     */
    private static String normalizeHost(String host) {
        if (host == null) return null;
        String normalized = host.toLowerCase(Locale.ROOT);
        if (normalized.startsWith("[") && normalized.endsWith("]")) {
            normalized = normalized.substring(1, normalized.length() - 1);
        }
        return normalized;
    }

    /**
     * Extract an X509Certificate from Android's SslCertificate.
     * Uses SslCertificate.saveState() to get the raw cert bytes.
     */
    private static X509Certificate extractX509(SslCertificate sslCert) {
        try {
            Bundle bundle = SslCertificate.saveState(sslCert);
            byte[] certBytes = bundle.getByteArray("x509-certificate");
            if (certBytes != null) {
                CertificateFactory cf = CertificateFactory.getInstance("X.509");
                return (X509Certificate) cf.generateCertificate(new ByteArrayInputStream(certBytes));
            }
        } catch (Exception e) {
            // Ignore
        }
        return null;
    }

    /**
     * Compute SHA-256 fingerprint of an X.509 certificate.
     * Returns colon-separated uppercase hex (e.g., "AB:CD:12:...").
     */
    private static String sha256Fingerprint(X509Certificate cert) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] digest = md.digest(cert.getEncoded());
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < digest.length; i++) {
            if (i > 0) sb.append(":");
            sb.append(String.format("%02X", digest[i]));
        }
        return sb.toString();
    }
}
