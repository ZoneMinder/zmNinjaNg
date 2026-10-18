/**
 * Developer Notice Page
 *
 * Lists every notice fetched from the feed. Unread notices appear at the
 * top (bold). Expanding a row marks it read. If the feed fetch fails,
 * a card at the top explains the failure with the URL and a Retry button.
 *
 * refs #172
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button, HintButton } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Megaphone, AlertTriangle, AlertCircle, Info, ChevronDown, ChevronUp, ExternalLink, RefreshCw, Eye, EyeOff, CheckCheck, Mail, Trash2, MoreVertical, RotateCcw } from 'lucide-react';
import { useDeveloperNotices, type DeveloperNoticeView } from '../hooks/useDeveloperNotices';
import { useDeveloperNoticeStore } from '../stores/developerNotices';
import { useDateTimeFormat } from '../hooks/useDateTimeFormat';
import { Markdown } from '../lib/markdown';
import { isSafeLinkHref } from '../lib/safe-url';
import { resolveQueryError } from '../lib/query/query-error';
import { DEVELOPER_NOTICES } from '../lib/zmninja-ng-constants';
import { cn } from '../lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../components/ui/alert-dialog';

function severityIcon(severity: DeveloperNoticeView['severity']) {
  if (severity === 'critical') return AlertCircle;
  if (severity === 'warning') return AlertTriangle;
  return Info;
}

function severityClass(severity: DeveloperNoticeView['severity']) {
  if (severity === 'critical') return 'text-destructive';
  if (severity === 'warning') return 'text-amber-500';
  return 'text-primary';
}

function NoticeRow({ notice }: { notice: DeveloperNoticeView }) {
  const { t } = useTranslation();
  const { fmtDateTime } = useDateTimeFormat();
  const markRead = useDeveloperNoticeStore((s) => s.markRead);
  const markUnread = useDeveloperNoticeStore((s) => s.markUnread);
  const deleteNotice = useDeveloperNoticeStore((s) => s.deleteNotice);
  const [expanded, setExpanded] = useState(!notice.isRead);
  const Icon = severityIcon(notice.severity);

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !notice.isRead) {
      markRead(notice.id);
    }
  };

  const handleReadToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (notice.isRead) {
      markUnread(notice.id);
    } else {
      markRead(notice.id);
    }
  };

  return (
    <div
      className={cn(
        'rounded-lg border bg-card',
        !notice.isRead && 'border-primary/60',
      )}
      data-testid={`developer-notice-${notice.id}`}
    >
      <div className="flex items-start gap-3 px-3 py-2">
        <button
          type="button"
          onClick={handleToggle}
          className="flex flex-1 items-start gap-3 text-left min-w-0"
          data-testid={`developer-notice-toggle-${notice.id}`}
          aria-expanded={expanded}
        >
          <Icon className={cn('h-4 w-4 mt-1 flex-shrink-0', severityClass(notice.severity))} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn('text-sm', !notice.isRead ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                {notice.title}
              </span>
              {!notice.isRead && (
                <Badge variant="default" className="text-[10px] h-4 px-1.5">
                  {t('developer_notice.unread')}
                </Badge>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5" data-testid={`developer-notice-meta-${notice.id}`}>
              {/* Release notices carry their version as minAppVersion. */}
              {notice.minAppVersion && `v${notice.minAppVersion} · `}
              {fmtDateTime(new Date(notice.publishedAt))}
            </div>
          </div>
        </button>
        <HintButton
          type="button"
          onClick={handleReadToggle}
          className="mt-0.5 p-1 rounded hover:bg-accent text-muted-foreground flex-shrink-0"
          title={notice.isRead ? t('developer_notice.mark_unread') : t('developer_notice.mark_read')}
          aria-label={notice.isRead ? t('developer_notice.mark_unread') : t('developer_notice.mark_read')}
          data-testid={`developer-notice-read-toggle-${notice.id}`}
        >
          {notice.isRead ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </HintButton>
        <HintButton
          type="button"
          onClick={(e) => { e.stopPropagation(); deleteNotice(notice.id); }}
          className="mt-0.5 p-1 rounded hover:bg-accent text-muted-foreground flex-shrink-0"
          title={t('developer_notice.delete')}
          aria-label={t('developer_notice.delete')}
          data-testid={`developer-notice-delete-${notice.id}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </HintButton>
        <HintButton
          type="button"
          onClick={handleToggle}
          className="mt-0.5 p-1 rounded hover:bg-accent text-muted-foreground flex-shrink-0"
          title={expanded ? t('common.close') : t('common.view')}
          aria-label={expanded ? t('common.close') : t('common.view')}
          data-testid={`developer-notice-chevron-${notice.id}`}
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </HintButton>
      </div>
      {expanded && (
        <div className="px-3 pb-3 pl-10 pt-2 border-t border-border/40 mt-1">
          <Markdown source={notice.body} />
          {notice.link && isSafeLinkHref(notice.link) && (
            <a
              href={notice.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 mt-3 text-xs text-primary hover:underline"
              data-testid={`developer-notice-link-${notice.id}`}
            >
              {t('developer_notice.open_link')}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export default function DeveloperNotice() {
  const { t } = useTranslation();
  const { notices, isLoading, isError, error, refetch } = useDeveloperNotices();
  const markAllRead = useDeveloperNoticeStore((s) => s.markAllRead);
  const markAllUnread = useDeveloperNoticeStore((s) => s.markAllUnread);
  const deleteNotices = useDeveloperNoticeStore((s) => s.deleteNotices);
  const restoreAllDeleted = useDeveloperNoticeStore((s) => s.restoreAllDeleted);
  const deletedIds = useDeveloperNoticeStore((s) => s.deletedIds);
  const [clearAllOpen, setClearAllOpen] = useState(false);

  const unreadIds = notices.filter((n) => !n.isRead).map((n) => n.id);
  const readIds = notices.filter((n) => n.isRead).map((n) => n.id);
  const hasDeleted = deletedIds.length > 0;
  const visibleIds = notices.map((n) => n.id);
  const handleRestore = () => { restoreAllDeleted(); refetch(); };

  return (
    <div className="max-w-3xl mx-auto p-3 sm:p-6 space-y-4">
      <div className="flex items-start gap-3">
        <Megaphone className="h-6 w-6 text-primary mt-1" />
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">{t('developer_notice.page_title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('developer_notice.page_subtitle')}</p>
        </div>
      </div>

      {isError && (
        <Card className="border-destructive/40" data-testid="developer-notice-error">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              {t('developer_notice.fetch_failed_title')}
            </CardTitle>
            <CardDescription className="break-all font-mono text-xs mt-2">
              {DEVELOPER_NOTICES.feedUrl}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {resolveQueryError(error, t, { fallbackKey: 'developer_notice.fetch_failed_generic' })}
            </p>
            <Button size="sm" onClick={() => refetch()} data-testid="developer-notice-retry">
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              {t('common.try_again')}
            </Button>
          </CardContent>
        </Card>
      )}

      {isLoading && !isError && (
        <p className="text-sm text-muted-foreground">{t('developer_notice.loading')}</p>
      )}

      {!isLoading && !isError && notices.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground space-y-3">
            <p>{t('developer_notice.empty_state')}</p>
            {hasDeleted && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRestore}
                data-testid="developer-notice-restore-deleted-empty"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                {t('developer_notice.restore_deleted')}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {(notices.length > 0 || hasDeleted) && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            title={t('developer_notice.reload')}
            aria-label={t('developer_notice.reload')}
            data-testid="developer-notice-reload"
            className="h-9 w-9"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                title={t('developer_notice.more_actions')}
                aria-label={t('developer_notice.more_actions')}
                data-testid="developer-notice-actions-menu"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={unreadIds.length === 0}
                onClick={() => markAllRead(unreadIds)}
                data-testid="developer-notice-mark-all-read"
              >
                <CheckCheck className="h-3.5 w-3.5 mr-2" />
                {t('developer_notice.mark_all_read')}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={readIds.length === 0}
                onClick={() => markAllUnread(readIds)}
                data-testid="developer-notice-mark-all-unread"
              >
                <Mail className="h-3.5 w-3.5 mr-2" />
                {t('developer_notice.mark_all_unread')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={notices.length === 0}
                onClick={() => setClearAllOpen(true)}
                className="text-destructive focus:text-destructive"
                data-testid="developer-notice-clear-all"
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                {t('developer_notice.clear_all')}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!hasDeleted}
                onClick={handleRestore}
                data-testid="developer-notice-restore-deleted"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-2" />
                {t('developer_notice.restore_deleted')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {notices.length > 0 && (
        <div className="space-y-2" data-testid="developer-notice-list">
          {notices.map((n) => (
            <NoticeRow key={n.id} notice={n} />
          ))}
        </div>
      )}

      <AlertDialog open={clearAllOpen} onOpenChange={setClearAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('developer_notice.clear_all_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('developer_notice.clear_all_confirm_body', { count: notices.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="developer-notice-clear-all-cancel">
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteNotices(visibleIds)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="developer-notice-clear-all-confirm"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
