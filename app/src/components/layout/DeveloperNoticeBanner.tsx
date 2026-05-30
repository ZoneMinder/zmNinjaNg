/**
 * Critical Developer Notice Banner
 *
 * Renders a dismissible banner at the top of the app when there is an
 * unread notice with severity "critical" (security advisories, urgent
 * action items). Only the highest-priority unread critical surfaces;
 * less urgent ones live on the Developer Notice page. refs #172
 */

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, X } from 'lucide-react';
import { useDeveloperNotices } from '../../hooks/useDeveloperNotices';
import { useDeveloperNoticeStore } from '../../stores/developerNotices';
import { Button } from '../ui/button';

export function DeveloperNoticeBanner() {
  const { t } = useTranslation();
  const { criticalUnread } = useDeveloperNotices();
  const isBannerDismissed = useDeveloperNoticeStore((s) => s.isBannerDismissed);
  const dismissBanner = useDeveloperNoticeStore((s) => s.dismissBanner);

  const target = criticalUnread.find((n) => !isBannerDismissed(n.id));
  if (!target) return null;

  return (
    <div
      className="bg-destructive text-destructive-foreground px-3 py-2 flex items-center gap-3"
      data-testid="developer-notice-banner"
      role="alert"
    >
      <AlertCircle className="h-4 w-4 flex-shrink-0" />
      <div className="flex-1 min-w-0 text-sm">
        <span className="font-semibold mr-2">{t('developer_notice.critical_label')}:</span>
        <Link to="/developer-notice" className="underline hover:opacity-90 truncate">
          {target.title}
        </Link>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-destructive-foreground hover:bg-destructive-foreground/15"
        onClick={() => dismissBanner(target.id)}
        title={t('common.close')}
        data-testid="developer-notice-banner-dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
