// Shows the messages from ToastService at the bottom of the screen.
import { Component, inject } from '@angular/core';
import { ToastService } from '../core/toast.service';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-toasts',
  imports: [IconComponent],
  template: `
    <div class="stack" aria-live="polite">
      @for (toast of toasts.toasts(); track toast.id) {
        <button type="button" class="toast" [class.error]="toast.kind === 'error'" (click)="toasts.dismiss(toast.id)">
          <app-icon [name]="toast.kind === 'error' ? 'alert' : 'check'" [size]="16" />
          <span>{{ toast.text }}</span>
        </button>
      }
    </div>
  `,
  styles: `
    .stack {
      position: fixed;
      left: 50%;
      bottom: 20px;
      transform: translateX(-50%);
      z-index: 200;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      width: min(440px, calc(100vw - 32px));
      pointer-events: none;
    }

    .toast {
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: 10px;
      max-width: 100%;
      padding: 11px 16px;
      border: 0;
      border-radius: 12px;
      background: #211712;
      color: #faf3e7;
      font-size: 13.5px;
      font-weight: 700;
      text-align: left;
      box-shadow: var(--shadow-lg);
    }

    .toast app-icon {
      color: #ff8657;
    }

    .toast.error {
      background: #7a1b12;
    }

    .toast.error app-icon {
      color: #ffd9c4;
    }
  `,
})
export class ToastsComponent {
  protected readonly toasts = inject(ToastService);
}
