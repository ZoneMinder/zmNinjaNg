/**
 * Labelled date-and-time field with its own picker button.
 *
 * Chromium draws a calendar button on a `datetime-local` input, but it will
 * not open the chooser from that button while the input sits inside a Radix
 * popover layer: the glyph renders, clicking it does nothing, and the same
 * field in the timeline's plain panel opens it fine. `modal` on the popover
 * makes no difference, and neither does making the glyph inert.
 *
 * Calling `showPicker()` from inside that same popover does work, so the
 * browser's dead glyph is hidden and this button replaces it. The field stays
 * typable, which a picker bound to the whole input would have taken away.
 */
import type { KeyboardEvent, RefObject } from 'react';
import { Calendar } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

interface DateTimeFieldProps {
  id: string;
  label: string;
  /** Uncontrolled: the caller keys the field to re-seed it (refs #495). */
  defaultValue: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  testId: string;
}

export function DateTimeField({ id, label, defaultValue, inputRef, onKeyDown, testId }: DateTimeFieldProps) {
  const { t } = useTranslation();

  const openPicker = () => {
    try {
      inputRef.current?.showPicker();
    } catch {
      // No chooser for this type, or a browser without showPicker: the field
      // is still typable.
    }
  };

  return (
    <div className="grid gap-2">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <div className="relative">
        <Input
          ref={inputRef}
          id={id}
          type="datetime-local"
          defaultValue={defaultValue}
          onKeyDown={onKeyDown}
          step="1"
          className="pr-10 [&::-webkit-calendar-picker-indicator]:hidden"
          data-testid={testId}
        />
        <button
          type="button"
          onClick={openPicker}
          title={t('events.open_date_picker')}
          aria-label={t('events.open_date_picker')}
          className="absolute inset-y-0 right-0 flex items-center px-3 rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid={`${testId}-picker`}
        >
          <Calendar className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
