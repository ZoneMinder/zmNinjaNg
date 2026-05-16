/**
 * Profiles Page
 *
 * Manages server connection profiles.
 * Allows adding, editing, deleting, and switching between ZoneMinder servers.
 */

import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProfileStore } from '../stores/profile';
import { useCurrentProfile } from '../hooks/useCurrentProfile';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
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
import { Server, Edit, Plus, Check, Loader2, Eye, EyeOff, Trash2 } from 'lucide-react';
import { PageContainer } from '../components/common/PageContainer';
import { Badge } from '../components/ui/badge';
import type { Profile } from '../api/types';
import { useToast } from '../hooks/use-toast';
import { toast as sonnerToast } from 'sonner';
import { setApiClient } from '../api/client';
import { discoverUrls } from '../lib/discovery';
import { useTranslation } from 'react-i18next';
import { NotificationBadge } from '../components/NotificationBadge';

export default function Profiles() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();

  const profiles = useProfileStore((state) => state.profiles);
  const { currentProfile } = useCurrentProfile();
  const updateProfile = useProfileStore((state) => state.updateProfile);
  const deleteProfile = useProfileStore((state) => state.deleteProfile);
  const deleteAllProfiles = useProfileStore((state) => state.deleteAllProfiles);
  const switchProfile = useProfileStore((state) => state.switchProfile);

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleteAllDialogOpen, setIsDeleteAllDialogOpen] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [switchingProfileId, setSwitchingProfileId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    portalUrl: '',
    apiUrl: '',
    cgiUrl: '',
    username: '',
    password: '',
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

    setFormData({
      name: profile.name,
      portalUrl: profile.portalUrl,
      apiUrl: profile.apiUrl,
      cgiUrl: profile.cgiUrl,
      username: profile.username || '',
      password: decryptedPassword,
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
      let portalUrl = formData.portalUrl.replace(/\/$/, '');

      // If URLs were manually edited, use them; otherwise discover from portal URL
      let apiUrl = formData.apiUrl;
      let cgiUrl = formData.cgiUrl;

      // If URLs are empty, discover working URLs
      if (!apiUrl || !cgiUrl) {
        const credentials = formData.username && formData.password
          ? { username: formData.username, password: formData.password }
          : undefined;
        const discovered = await discoverUrls(portalUrl, {
          credentials,
          onClientCreated: (client) => {
            setApiClient(client);
          },
        });
        apiUrl = discovered.apiUrl;
        cgiUrl = discovered.cgiUrl;
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
        username: normalizedUsername || undefined,
        password: formData.password || undefined,
      };

      await updateProfile(selectedProfile.id, updates);

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

  const switchAbortRef = useRef<AbortController | null>(null);

  const handleSwitchProfile = async (profileId: string) => {
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) return;

    // Abort any in-flight switch attempt
    if (switchAbortRef.current) {
      switchAbortRef.current.abort();
    }
    const abort = new AbortController();
    switchAbortRef.current = abort;

    // Clear previous state
    sonnerToast.dismiss();
    setSwitchingProfileId(profileId);
    const loadingToast = sonnerToast.loading(t('profiles.switching_to', { name: profile.name }));

    try {
      await switchProfile(profileId);

      // If this switch was aborted (user clicked another profile), bail
      if (abort.signal.aborted) return;

      sonnerToast.dismiss(loadingToast);
      sonnerToast.success(t('profiles.switched_to', { name: profile.name }));
      setSwitchingProfileId(null);
      navigate('/monitors');
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
                    <Button
                      onClick={() => setIsDeleteAllDialogOpen(true)}
                      variant="destructive"
                      className="h-9 sm:h-10"
                      data-testid="profiles-delete-all-button"
                    >
                      <Trash2 className="h-4 w-4 sm:mr-2" />
                      <span className="hidden sm:inline">{t('profiles.delete_all')}</span>
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3" data-testid="profile-list">
                {profiles.map((profile) => (
                  <div
                    key={profile.id}
                    className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                    data-testid="profile-card"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {profile.id === currentProfile?.id && (
                        <Check className="h-4 w-4 text-primary shrink-0" data-testid="profile-active-indicator" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium" data-testid="profile-name">{profile.name}</span>
                          {profile.isDefault && (
                            <Badge variant="secondary" className="text-xs">{t('profiles.default')}</Badge>
                          )}
                          {profile.username && profile.password ? (
                            <Badge variant="outline" className="text-xs text-green-600 dark:text-green-400 border-green-600 dark:border-green-400">
                              ✓ {t('profiles.credentials')}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs text-orange-600 dark:text-orange-400 border-orange-600 dark:border-orange-400">
                              ⚠ {t('profiles.no_credentials')}
                            </Badge>
                          )}
                        </div>
                        <div className="space-y-1 text-xs font-mono">
                          <p className="text-muted-foreground break-all">
                            <span className="font-sans font-medium text-foreground">{t('profiles.portal')}:</span> {profile.portalUrl}
                          </p>
                          <p className="text-muted-foreground break-all">
                            <span className="font-sans font-medium text-foreground">{t('profiles.api')}:</span> {profile.apiUrl}
                          </p>
                          <p className="text-muted-foreground break-all">
                            <span className="font-sans font-medium text-foreground">{t('profiles.streaming')}:</span> {profile.cgiUrl}
                          </p>
                        </div>
                        {!(profile.username && profile.password) && (
                          <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                            {t('profiles.add_creds_hint')}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {profile.id !== currentProfile?.id && (
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
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenEditDialog(profile)}
                        aria-label={t('common.edit')}
                        data-testid={`profile-edit-button-${profile.id}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      {profiles.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenDeleteDialog(profile)}
                          className="text-destructive hover:text-destructive"
                          aria-label={t('common.delete')}
                          data-testid={`profile-delete-button-${profile.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
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
              <p className="text-xs text-muted-foreground">
                {t('profiles.manual_override_hint')}
              </p>
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
