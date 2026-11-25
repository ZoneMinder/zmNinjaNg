/**
 * Profiles Page
 *
 * Manages server connection profiles.
 * Allows adding, editing, deleting, and switching between ZoneMinder servers.
 */

import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useProfileStore, ProfileGuardError } from '../stores/profile';
import { useSettingsStore } from '../stores/settings';
import { useCurrentProfile } from '../hooks/useCurrentProfile';
import { useAggregateLabel } from '../hooks/useAggregateLabel';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Switch } from '../components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { Server, Plus, Check, Loader2, Eye, EyeOff, Trash2, MoreVertical } from 'lucide-react';
import { PageContainer } from '../components/common/PageContainer';
import { Badge } from '../components/ui/badge';
import type { Profile, VirtualProfile } from '../api/types';
import { isAggregateProfileId } from '../api/types';
import { VirtualProfileCard } from '../components/profiles/VirtualProfileCard';
import { ServerUrlDisclosure } from '../components/profiles/ServerUrlDisclosure';
import { ProfileActionsMenu } from '../components/profiles/ProfileActionsMenu';
import { ProfileStreamBadge } from '../components/profiles/ProfileStreamBadge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../components/ui/dropdown-menu';
import { countActiveMembers } from '../lib/profile/virtual-profile';
import { resolveSwitchDestination } from '../lib/navigation';
import { VirtualProfileDialog } from '../components/profiles/VirtualProfileDialog';
import { useToast } from '../hooks/use-toast';
import { toast as sonnerToast } from 'sonner';
import { discoverUrls } from '../services/discovery';
import { useTranslation } from 'react-i18next';
import { NotificationBadge } from '../components/NotificationBadge';

export default function Profiles() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();

  const profiles = useProfileStore((state) => state.profiles);
  // A new group is only meaningful with 2+ SELECTABLE profiles - a disabled
  // one can never join an aggregate (refs #337).
  const enabledProfileCount = profiles.filter((p) => !p.disabled).length;
  const { currentProfile } = useCurrentProfile();
  const currentProfileId = useProfileStore((state) => state.currentProfileId);
  const aggregateLabel = useAggregateLabel();
  const updateProfile = useProfileStore((state) => state.updateProfile);
  const deleteProfile = useProfileStore((state) => state.deleteProfile);
  const deleteAllProfiles = useProfileStore((state) => state.deleteAllProfiles);
  const switchProfile = useProfileStore((state) => state.switchProfile);
  const setProfileDisabled = useProfileStore((state) => state.setProfileDisabled);
  // Raw slice with the `?? []` inside the selector so useShallow dedupes
  // repeated empty snapshots to one reference (see useProfileScope).
  const virtualProfiles = useProfileStore(useShallow((state) => state.virtualProfiles ?? []));
  const deleteVirtualProfile = useProfileStore((state) => state.deleteVirtualProfile);

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleteAllDialogOpen, setIsDeleteAllDialogOpen] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  // The group dialog is mounted only while open (never `open={false}`), so
  // opening it is what seeds its fields; `{ group: null }` is create mode.
  const [groupDialog, setGroupDialog] = useState<{ group: VirtualProfile | null } | null>(null);
  const [groupPendingDelete, setGroupPendingDelete] = useState<VirtualProfile | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [switchingProfileId, setSwitchingProfileId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    portalUrl: '',
    apiUrl: '',
    cgiUrl: '',
    username: '',
    password: '',
    allowSelfSignedCerts: false,
  });

  const [showPassword, setShowPassword] = useState(false);


  const handleOpenEditDialog = async (profile: Profile) => {
    setSelectedProfile(profile);

    // Decrypt password if it exists
    let decryptedPassword = '';
    if (profile.password === 'stored-securely') {
      const getDecryptedPassword = useProfileStore.getState().getDecryptedPassword;
      decryptedPassword = await getDecryptedPassword(profile.id) || '';
    } else {
      decryptedPassword = profile.password || '';
    }

    const profileSettings = useSettingsStore.getState().getProfileSettings(profile.id);

    setFormData({
      name: profile.name,
      portalUrl: profile.portalUrl,
      apiUrl: profile.apiUrl,
      cgiUrl: profile.cgiUrl,
      username: profile.username || '',
      password: decryptedPassword,
      allowSelfSignedCerts: profileSettings.allowSelfSignedCerts,
    });
    setShowPassword(false);
    setIsEditDialogOpen(true);
  };

  const handleOpenDeleteDialog = (profile: Profile) => {
    setSelectedProfile(profile);
    setIsDeleteDialogOpen(true);
  };

  const handleUpdateProfile = async () => {
    if (!selectedProfile || !formData.name || !formData.portalUrl) {
      toast({
        title: t('common.error'),
        description: t('profiles.name_url_required'),
        variant: 'destructive',
      });
      return;
    }

    const normalizedUsername = formData.username.trim();
    const hasUsername = normalizedUsername.length > 0;
    const hasPassword = formData.password.length > 0;
    if ((hasUsername && !hasPassword) || (hasPassword && !hasUsername)) {
      toast({
        title: t('common.error'),
        description: t('profiles.credentials_incomplete'),
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    try {
      // Apply SSL trust before discovery so it works against a self-signed server.
      // Pass the edited (not-yet-saved) values as a candidate, keeping the
      // profile's current stored fingerprint since this dialog doesn't re-verify it.
      const { applyTrustedCertificates } = await import('../lib/security/ssl-trust');
      const existingFingerprint = useSettingsStore.getState().getProfileSettings(
        selectedProfile.id
      ).trustedCertFingerprint;
      await applyTrustedCertificates({
        urls: [formData.portalUrl, formData.apiUrl, formData.cgiUrl],
        fingerprint: existingFingerprint,
        enabled: formData.allowSelfSignedCerts,
      });

      let portalUrl = formData.portalUrl.replace(/\/$/, '');

      // If URLs were manually edited, use them; otherwise discover from portal URL
      let apiUrl = formData.apiUrl;
      let cgiUrl = formData.cgiUrl;
      // Still a guess only while the field holds the guessed URL (refs #603).
      let cgiUrlGuessed = !!selectedProfile.cgiUrlGuessed && cgiUrl === selectedProfile.cgiUrl;

      // If URLs are empty, discover working URLs
      if (!apiUrl || !cgiUrl) {
        const credentials = formData.username && formData.password
          ? { username: formData.username, password: formData.password }
          : undefined;
        const discovered = await discoverUrls(portalUrl, {
          profileId: selectedProfile.id,
          credentials,
        });
        apiUrl = discovered.apiUrl;
        cgiUrl = discovered.cgiUrl;
        cgiUrlGuessed = discovered.cgiUrlSource === 'default';
        // Update portalUrl to match the discovered confirmed one
        portalUrl = discovered.portalUrl;
      } else {
        // URLs were manually provided - ensure portalUrl has a scheme
        if (!portalUrl.startsWith('http://') && !portalUrl.startsWith('https://')) {
          // Derive scheme from apiUrl if available
          portalUrl = apiUrl.startsWith('https://') ? `https://${portalUrl}` : `http://${portalUrl}`;
        }
      }

      const updates: Partial<Profile> = {
        name: formData.name,
        portalUrl,
        apiUrl,
        cgiUrl,
        cgiUrlGuessed: cgiUrlGuessed || undefined,
        username: normalizedUsername || undefined,
        password: formData.password || undefined,
      };

      await updateProfile(selectedProfile.id, updates);

      useSettingsStore.getState().updateProfileSettings(selectedProfile.id, {
        allowSelfSignedCerts: formData.allowSelfSignedCerts,
      });

      // Re-apply from committed state now that the profile's URLs/settings are saved.
      await applyTrustedCertificates();

      toast({
        title: t('common.success'),
        description: t('profiles.update_success'),
      });

      setIsEditDialogOpen(false);
      setSelectedProfile(null);

      // If we updated the current profile, reload to re-authenticate and apply changes
      if (selectedProfile.id === currentProfile?.id) {
        setTimeout(() => {
          window.location.reload();
        }, 500);
      }
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('profiles.update_error'),
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteProfile = async () => {
    if (!selectedProfile) return;

    try {
      // Store current/active status before deletion
      const isDeletingCurrent = selectedProfile.id === currentProfile?.id;

      await deleteProfile(selectedProfile.id);

      toast({
        title: t('common.success'),
        description: t('profiles.delete_success'),
      });

      setIsDeleteDialogOpen(false);
      setSelectedProfile(null);

      // Check remaining profiles from FRESH state
      const remainingProfiles = useProfileStore.getState().profiles;

      if (remainingProfiles.length === 0) {
        // If no profiles left, go to profile creation
        navigate('/profiles/new');
      } else if (isDeletingCurrent) {
        // If we deleted the active profile, reload to ensure clean state specific
        // to the new auto-selected profile (which the store selects)
        window.location.reload();
      }
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('profiles.delete_error'),
        variant: 'destructive',
      });
    }
  };

  const handleDeleteAllProfiles = async () => {
    try {
      await deleteAllProfiles();

      toast({
        title: t('common.success'),
        description: t('profiles.delete_all_success'),
      });

      setIsDeleteAllDialogOpen(false);

      // Redirect to profile creation since no profiles exist
      navigate('/profiles/new');
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('profiles.delete_all_error'),
        variant: 'destructive',
      });
    }
  };

  const handleToggleDisabled = (profile: Profile) => {
    try {
      setProfileDisabled(profile.id, !profile.disabled);
    } catch (error) {
      sonnerToast.error(
        error instanceof ProfileGuardError && error.code === 'CANNOT_DISABLE_CURRENT'
          ? t('profiles.cannot_disable_active')
          : t('common.error')
      );
    }
  };

  const handleDeleteGroup = () => {
    if (!groupPendingDelete) return;
    try {
      // Only the grouping goes: the member profiles are untouched, which is
      // what the confirmation copy promises.
      deleteVirtualProfile(groupPendingDelete.id);
      setGroupPendingDelete(null);
      sonnerToast.success(t('profiles.delete_group_success'));
    } catch {
      sonnerToast.error(t('profiles.delete_group_error'));
    }
  };

  const switchAbortRef = useRef<AbortController | null>(null);

  const handleSwitchProfile = async (profileId: string) => {
    const isAggregateTarget = isAggregateProfileId(profileId);
    const profile = profiles.find((p) => p.id === profileId);
    // No aggregate id has a profile record behind it; every other id must
    // resolve to one.
    if (!isAggregateTarget && !profile) return;
    const name = isAggregateTarget ? aggregateLabel(profileId) : profile!.name;

    // Abort any in-flight switch attempt
    if (switchAbortRef.current) {
      switchAbortRef.current.abort();
    }
    const abort = new AbortController();
    switchAbortRef.current = abort;

    // Clear previous state
    sonnerToast.dismiss();
    setSwitchingProfileId(profileId);
    const loadingToast = sonnerToast.loading(t('profiles.switching_to', { name }));

    try {
      await switchProfile(profileId);

      // If this switch was aborted (user clicked another profile), bail
      if (abort.signal.aborted) return;

      sonnerToast.dismiss(loadingToast);
      sonnerToast.success(t('profiles.switched_to', { name }));
      setSwitchingProfileId(null);
      // The page this profile (or group) was last on, not always /monitors:
      // the app remembers one per profile and reopens on it at startup, and
      // a switch used to throw that away (refs #337). Read after the switch,
      // so the bucket is the one just selected.
      navigate(
        resolveSwitchDestination(
          useSettingsStore.getState().getProfileSettings(profileId).lastRoute
        )
      );
    } catch {
      if (abort.signal.aborted) return;
      sonnerToast.dismiss(loadingToast);
      sonnerToast.error(t('profiles.switch_failed'));
      setSwitchingProfileId(null);
    }
  };

  return (
    <>
      <PageContainer spacing="none" className="space-y-4 sm:space-y-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base sm:text-lg font-bold tracking-tight">{t('profiles.title')}</h1>
            <NotificationBadge />
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 hidden sm:block">
            {t('profiles.subtitle')}
          </p>
        </div>

        <div className="grid gap-4 sm:gap-6">
          {/* Profiles Management */}
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Server className="h-5 w-5 text-primary" />
                    <CardTitle className="text-lg sm:text-xl">{t('profiles.server_connections')}</CardTitle>
                  </div>
                  <CardDescription className="mt-1 text-xs sm:text-sm">
                    {t('profiles.manage_servers')}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button onClick={() => navigate('/profiles/new?returnTo=/profiles')} className="h-9 sm:h-10" data-testid="profiles-add-button">
                    <Plus className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">{t('profiles.add_profile')}</span>
                  </Button>
                  {profiles.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-9 w-9 sm:h-10 sm:w-10"
                          title={t('profiles.more_actions')}
                          aria-label={t('profiles.more_actions')}
                          data-testid="profiles-menu"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => setIsDeleteAllDialogOpen(true)}
                          className="text-destructive focus:text-destructive"
                          data-testid="profiles-delete-all-button"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          {t('profiles.delete_all')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3" data-testid="profile-list">
                {profiles.map((profile) => (
                  <div
                    key={profile.id}
                    className={`flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors ${profile.disabled ? 'opacity-60' : ''}`}
                    data-testid="profile-card"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {/* Always present, empty when this is not the current
                          profile, so selecting a row does not shift its name
                          and badges sideways. */}
                      <span className="w-4 shrink-0">
                        {profile.id === currentProfile?.id && (
                          <Check className="h-4 w-4 text-primary" data-testid="profile-active-indicator" />
                        )}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium" data-testid="profile-name">{profile.name}</span>
                          {profile.isDefault && (
                            <Badge variant="secondary" className="text-xs">{t('profiles.default')}</Badge>
                          )}
                          {profile.disabled && (
                            <Badge variant="outline" className="text-xs" data-testid="profile-disabled-badge">
                              {t('profiles.disabled')}
                            </Badge>
                          )}
                          {!(profile.username && profile.password) && (
                            <Badge variant="outline" className="text-xs text-orange-600 dark:text-orange-400 border-orange-600 dark:border-orange-400">
                              ⚠ {t('profiles.no_credentials')}
                            </Badge>
                          )}
                          <ProfileStreamBadge profile={profile} />
                        </div>
                        <ServerUrlDisclosure
                          testId={`profile-urls-${profile.id}`}
                          rows={[
                            { label: t('profiles.portal'), url: profile.portalUrl },
                            { label: t('profiles.api'), url: profile.apiUrl },
                            { label: t('profiles.streaming'), url: profile.cgiUrl },
                          ].filter((row) => row.url)}
                        />
                        {!(profile.username && profile.password) && (
                          <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                            {t('profiles.add_creds_hint')}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!profile.disabled && profile.id !== currentProfile?.id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleSwitchProfile(profile.id)}
                          data-testid={`profile-switch-button-${profile.id}`}
                        >
                          {switchingProfileId === profile.id ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              {t('profiles.switching')}
                            </>
                          ) : (
                            t('profiles.switch')
                          )}
                        </Button>
                      )}
                      <ProfileActionsMenu
                        targetId={profile.id}
                        disabled={!!profile.disabled}
                        onEdit={() => handleOpenEditDialog(profile)}
                        onToggleDisabled={() => handleToggleDisabled(profile)}
                        // The last profile stays, or the app has no server to
                        // talk to and no way back except setup.
                        onDelete={profiles.length > 1 ? () => handleOpenDeleteDialog(profile) : undefined}
                      />
                    </div>
                  </div>
                ))}
              </div>
              {/* Groups render whatever the enabled count is, so a group made
                  while two servers were enabled stays editable and deletable
                  after one is disabled. Only creating a new one is gated. */}
              {virtualProfiles.map((group) => (
                <VirtualProfileCard
                  key={group.id}
                  group={group}
                  isActive={currentProfileId === group.id}
                  isSwitching={switchingProfileId === group.id}
                  // The stored membership in stored order, so the list reads
                  // the way the group was built. A member that no longer
                  // exists simply drops out.
                  memberUrls={group.memberProfileIds
                    .map((id) => profiles.find((p) => p.id === id))
                    .filter((p): p is Profile => !!p)
                    .map((p) => ({ label: p.name, url: p.portalUrl }))}
                  activeMemberCount={countActiveMembers(group, profiles)}
                  onSwitch={() => handleSwitchProfile(group.id)}
                  onEdit={() => setGroupDialog({ group })}
                  onDelete={() => setGroupPendingDelete(group)}
                />
              ))}
              {enabledProfileCount >= 2 && (
                <Button
                  variant="outline"
                  className="mt-3 w-full"
                  onClick={() => setGroupDialog({ group: null })}
                  data-testid="profile-new-group-button"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t('profiles.new_group')}
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </PageContainer>

      {/* Edit Profile Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[500px]" data-testid="profile-edit-dialog">
          <DialogHeader>
            <DialogTitle>{t('profiles.edit_title')}</DialogTitle>
            <DialogDescription>
              {t('profiles.edit_desc')}
            </DialogDescription>
            {selectedProfile && !(selectedProfile.username && selectedProfile.password) && (
              <div className="mt-2 p-3 bg-orange-500/10 border border-orange-500/20 rounded-lg text-sm text-orange-600 dark:text-orange-400">
                ⚠ {t('profiles.no_creds_warning')}
              </div>
            )}
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">{t('profiles.name')}*</Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                data-testid="profile-edit-name"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-portalUrl">{t('profiles.portal_url')}*</Label>
              <Input
                id="edit-portalUrl"
                value={formData.portalUrl}
                onChange={(e) => setFormData({ ...formData, portalUrl: e.target.value })}
                autoCapitalize="none"
                autoCorrect="off"
                data-testid="profile-edit-portal-url"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-apiUrl">{t('profiles.api_url')}*</Label>
              <Input
                id="edit-apiUrl"
                value={formData.apiUrl}
                onChange={(e) => setFormData({ ...formData, apiUrl: e.target.value })}
                autoCapitalize="none"
                autoCorrect="off"
                data-testid="profile-edit-api-url"
              />
              <p className="text-xs text-muted-foreground">
                {t('profiles.manual_override_hint')}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-cgiUrl">{t('profiles.streaming_url')}*</Label>
              <Input
                id="edit-cgiUrl"
                value={formData.cgiUrl}
                onChange={(e) => setFormData({ ...formData, cgiUrl: e.target.value })}
                autoCapitalize="none"
                autoCorrect="off"
                data-testid="profile-edit-cgi-url"
              />
              {selectedProfile?.cgiUrlGuessed && formData.cgiUrl === selectedProfile.cgiUrl ? (
                <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="profile-edit-cgi-url-guessed">
                  {t('profiles.cgi_url_guessed')}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t('profiles.manual_override_hint')}
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-username">{t('profiles.username')}</Label>
              <Input
                id="edit-username"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                autoCapitalize="none"
                autoCorrect="off"
                data-testid="profile-edit-username"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-password">{t('profiles.password')}</Label>
              <div className="relative">
                <Input
                  id="edit-password"
                  type={showPassword || !formData.password ? "text" : "password"}
                  placeholder={t('profiles.enter_password')}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="pr-10"
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="new-password"
                  data-testid="profile-edit-password"
                />
                {formData.password && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                    title={showPassword ? t('common.hide_password') : t('common.show_password')}
                    aria-label={showPassword ? t('common.hide_password') : t('common.show_password')}
                    data-testid="profile-edit-password-toggle"
                  >
                    {showPassword ? (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {t('profiles.password_hint')}
              </p>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="edit-self-signed-certs" className="text-sm text-muted-foreground cursor-pointer">
                {t('settings.allow_self_signed_certs')}
              </Label>
              <Switch
                id="edit-self-signed-certs"
                checked={formData.allowSelfSignedCerts}
                onCheckedChange={(checked) => setFormData({ ...formData, allowSelfSignedCerts: checked })}
                data-testid="profile-edit-self-signed-certs-switch"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)} data-testid="profile-edit-cancel">
              {t('common.cancel')}
            </Button>
            <Button onClick={handleUpdateProfile} disabled={isSaving} data-testid="profile-edit-save">
              {isSaving ? t('common.saving') : t('common.save_changes')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog >

      {/* Delete Confirmation Dialog */}
      < AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen} >
        <AlertDialogContent data-testid="profile-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('profiles.delete_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('profiles.delete_confirm_desc', { name: selectedProfile?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="profile-delete-cancel">{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteProfile}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="profile-delete-confirm"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {groupDialog && (
        <VirtualProfileDialog group={groupDialog.group} onClose={() => setGroupDialog(null)} />
      )}

      {/* Delete Group Confirmation. The copy has to say the member servers
          survive: without it "Delete Backyard?" reads as deleting them. */}
      <AlertDialog
        open={groupPendingDelete !== null}
        onOpenChange={(open) => !open && setGroupPendingDelete(null)}
      >
        <AlertDialogContent data-testid="profile-virtual-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('profiles.delete_group_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('profiles.delete_group_confirm_desc', { name: groupPendingDelete?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="profile-virtual-delete-cancel">
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteGroup}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="profile-virtual-delete-confirm"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete All Profiles Confirmation Dialog */}
      <AlertDialog open={isDeleteAllDialogOpen} onOpenChange={setIsDeleteAllDialogOpen}>
        <AlertDialogContent data-testid="profiles-delete-all-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('profiles.delete_all_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('profiles.delete_all_confirm_desc', { count: profiles.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="profiles-delete-all-cancel">{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAllProfiles} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="profiles-delete-all-confirm">
              {t('profiles.delete_all_btn')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
