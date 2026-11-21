// One dropdown for the whole system (Batch 7): a field that opens a panel
// with a search input, rows with avatar initials, a name and a second line,
// and a count footer ("2 students"). It binds to the existing forms through
// ngModel, closes on selection, on Escape and on a click outside, and never
// closes its parent modal when opened inside one.
//
//   <app-dropdown
//     [(ngModel)]="grade"
//     [options]="gradeOptions"
//     placeholder="All grades"
//     countSingular="grade"
//     countPlural="grades" />
import { Component, ElementRef, computed, forwardRef, inject, input, signal } from '@angular/core';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';
import { IconComponent } from './icon.component';

export interface DropdownOption {
  value: string | number;
  label: string;
  sub?: string; // second line, for example a learner ID
  initials?: string; // avatar initials; taken from the label when not given
}

@Component({
  selector: 'app-dropdown',
  imports: [FormsModule, IconComponent],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DropdownComponent),
      multi: true,
    },
  ],
  template: `
    <div class="dd" [class.open]="open()" [class.invalid]="invalid()">
      <button
        type="button"
        class="dd-field"
        [disabled]="disabled()"
        [attr.aria-expanded]="open()"
        (click)="toggle()"
        (keydown.escape)="onEscape($event)"
        (keydown.arrowdown)="onArrow($event, 1)"
        (keydown.arrowup)="onArrow($event, -1)"
        (keydown.enter)="onEnter($event)"
      >
        <span class="dd-value" [class.placeholder]="!selected()">{{ selected()?.label ?? placeholder() }}</span>
        <app-icon name="chevron-down" [size]="16" />
      </button>

      @if (open()) {
        <div class="dd-panel" [class.align-right]="alignRight()" role="listbox">
          <div class="dd-search">
            <app-icon name="search" [size]="16" />
            <input
              type="text"
              [placeholder]="searchPlaceholder()"
              [ngModel]="query()"
              (ngModelChange)="query.set($event); active.set(0)"
              (keydown.escape)="onEscape($event)"
              (keydown.arrowdown)="onArrow($event, 1)"
              (keydown.arrowup)="onArrow($event, -1)"
              (keydown.enter)="onEnter($event)"
              #searchInput
            />
          </div>
          <div class="dd-rows">
            @for (option of filtered(); track option.value) {
              <button
                type="button"
                class="dd-row"
                [class.selected]="option.value === value()"
                [class.active]="$index === active()"
                role="option"
                [attr.aria-selected]="option.value === value()"
                (click)="select(option)"
                (mouseenter)="active.set($index)"
              >
                <span class="dd-avatar" aria-hidden="true">{{ initialsOf(option) }}</span>
                <span class="dd-text">
                  <span class="dd-label">{{ option.label }}</span>
                  @if (option.sub) {
                    <span class="dd-sub">{{ option.sub }}</span>
                  }
                </span>
                @if (option.value === value()) {
                  <app-icon name="check" [size]="16" />
                }
              </button>
            } @empty {
              <p class="dd-empty">No matches.</p>
            }
          </div>
          <p class="dd-count">{{ filtered().length }} {{ filtered().length === 1 ? countSingular() : countPlural() }}</p>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      position: relative;
      min-width: 0;
    }

    .dd-field {
      width: 100%;
      min-height: 42px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 9px 12px;
      border-radius: 8px;
      border: 1px solid var(--border-strong);
      background: var(--surface);
      color: var(--ink);
      font: inherit;
      font-size: 14px;
      text-align: left;
      cursor: pointer;
    }

    .dd-field:hover:not(:disabled) {
      border-color: var(--muted);
    }

    .dd.open .dd-field {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px var(--accent-tint);
    }

    .dd-field:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .dd.invalid .dd-field {
      border-color: var(--red);
    }

    .dd-value {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .dd-value.placeholder {
      color: var(--muted);
    }

    .dd.open .dd-field app-icon {
      transform: rotate(180deg);
    }

    .dd-field app-icon {
      flex: none;
      color: var(--muted);
      transition: transform 120ms ease;
    }

    .dd-panel {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      z-index: 60;
      min-width: 220px;
      /* The panel can never be wider than the viewport, whatever the trigger. */
      max-width: calc(100vw - 16px);
      border-radius: 8px;
      border: 1px solid var(--border-strong);
      background: var(--surface);
      box-shadow: var(--shadow-lg);
      overflow: hidden;
    }

    /* A narrow trigger near the viewport's right edge: anchor the panel's
       right edge to the trigger's right edge instead of its left edge, so
       the 220px minimum width runs left, not past the screen. */
    .dd-panel.align-right {
      left: auto;
      right: 0;
    }

    .dd-search {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      color: var(--muted);
    }

    .dd-search input {
      flex: 1;
      min-width: 0;
      border: 0;
      outline: none;
      background: transparent;
      color: var(--ink);
      font: inherit;
      font-size: 14px;
    }

    .dd-rows {
      max-height: 240px;
      overflow-y: auto;
      padding: 4px;
    }

    .dd-row {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--ink);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .dd-row:hover,
    .dd-row.active {
      background: var(--surface-3);
    }

    .dd-row.selected {
      background: var(--accent-tint);
    }

    .dd-avatar {
      flex: none;
      width: 32px;
      height: 32px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      background: var(--surface-3);
      color: var(--ink-2);
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 600;
    }

    .dd-row.selected .dd-avatar {
      background: var(--accent-tint-2);
      color: var(--accent-deep);
    }

    .dd-text {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .dd-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
      font-size: 14px;
    }

    .dd-sub {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--muted);
    }

    .dd-row app-icon {
      flex: none;
      color: var(--accent);
    }

    .dd-empty {
      margin: 0;
      padding: 14px 12px;
      color: var(--muted);
      font-size: 13.5px;
      text-align: center;
    }

    .dd-count {
      margin: 0;
      padding: 8px 12px;
      border-top: 1px solid var(--border);
      color: var(--muted);
      font-family: var(--font-mono);
      font-size: 12px;
    }
  `,
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'onDocumentEscape($event)',
  },
})
export class DropdownComponent implements ControlValueAccessor {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly options = input.required<DropdownOption[]>();
  readonly placeholder = input('Choose');
  readonly searchPlaceholder = input('Search');
  readonly countSingular = input('option');
  readonly countPlural = input('options');
  readonly disabled = input(false);
  readonly invalid = input(false);

  readonly value = signal<string | number | null>(null);
  readonly open = signal(false);
  readonly query = signal('');
  readonly active = signal(0);
  // True when the open panel is anchored to the trigger's right edge
  // because its 220px minimum width would otherwise run past the
  // viewport's right edge (a narrow trigger near the right edge).
  readonly alignRight = signal(false);

  private onChange: (value: string | number | null) => void = () => {};
  private onTouched: () => void = () => {};
  private isDisabled = false;

  readonly selected = computed(() => this.options().find((option) => option.value === this.value()) ?? null);

  readonly filtered = computed(() => {
    const query = this.query().trim().toLowerCase();
    if (!query) return this.options();
    return this.options().filter(
      (option) =>
        option.label.toLowerCase().includes(query) || (option.sub ?? '').toLowerCase().includes(query),
    );
  });

  // ---------- ControlValueAccessor ----------

  writeValue(value: string | number | null): void {
    this.value.set(value ?? null);
  }

  registerOnChange(fn: (value: string | number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.isDisabled = disabled;
  }

  // ---------- Behaviour ----------

  toggle(): void {
    if (this.isDisabled || this.disabled()) return;
    this.open() ? this.close() : this.openPanel();
  }

  select(option: DropdownOption): void {
    this.value.set(option.value);
    this.onChange(option.value);
    this.onTouched();
    this.close();
  }

  initialsOf(option: DropdownOption): string {
    if (option.initials) return option.initials;
    const words = option.label.trim().split(/\s+/);
    const first = words[0]?.[0] ?? '';
    const second = words.length > 1 ? words[1][0] : '';
    return (first + second).toUpperCase();
  }

  onEscape(event: Event): void {
    if (!this.open()) return;
    // The panel is open: swallow Escape so a parent modal does not close too.
    event.stopPropagation();
    this.close();
  }

  onDocumentEscape(event: Event): void {
    // A document-level Escape (for example from inside the search input, which
    // stops its own Escape) also closes the panel.
    if (this.open()) this.close();
  }

  onDocumentClick(event: MouseEvent): void {
    if (!this.open()) return;
    if (!this.host.nativeElement.contains(event.target as Node)) this.close();
  }

  onArrow(event: Event, step: number): void {
    if (!this.open()) {
      this.openPanel();
      event.preventDefault();
      return;
    }
    const rows = this.filtered();
    if (rows.length === 0) return;
    this.active.set((this.active() + step + rows.length) % rows.length);
    event.preventDefault();
  }

  onEnter(event: Event): void {
    if (!this.open()) return;
    const rows = this.filtered();
    const option = rows[this.active()] ?? rows[0];
    if (option) {
      this.select(option);
      event.preventDefault();
    }
  }

  private openPanel(): void {
    this.query.set('');
    this.active.set(0);
    this.alignRight.set(false);
    this.open.set(true);
    // The search input appears with the panel; focus it on the next frame,
    // and measure the panel so it never runs past the viewport's right edge.
    requestAnimationFrame(() => {
      this.alignPanel();
      (this.host.nativeElement.querySelector('.dd-search input') as HTMLInputElement | null)?.focus();
    });
  }

  private alignPanel(): void {
    const panel = this.host.nativeElement.querySelector('.dd-panel') as HTMLElement | null;
    if (!panel) return;
    this.alignRight.set(panel.getBoundingClientRect().right > window.innerWidth - 8);
  }

  private close(): void {
    this.open.set(false);
  }
}
