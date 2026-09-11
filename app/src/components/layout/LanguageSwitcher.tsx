/**
 * Language Switcher Component
 * Renders a dropdown to switch the application language.
 */

import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { cn } from '../../lib/utils';
import { useLanguageOptions } from '../../hooks/useLanguageOptions';

export function LanguageSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { i18n, t } = useTranslation();

  const languages = useLanguageOptions();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 px-2 gap-1 ml-1",
            collapsed && "w-8 p-0 justify-center ml-0 mt-2"
          )}
          title={t('sidebar.switch_language')}
          data-testid="language-switcher"
        >
          <Globe className="h-4 w-4" />
          {!collapsed && (
            <span className="text-xs uppercase font-medium">{i18n.language?.split('-')[0] || 'en'}</span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {languages.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => i18n.changeLanguage(lang.code)}
            className="text-xs"
            data-testid={`language-option-${lang.code}`}
          >
            {lang.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
