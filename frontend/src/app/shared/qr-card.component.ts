// A learner's QR pass card: the QR code for their learner ID, with Print and
// Download. The code holds "acadsync:<learner ID>" — the same code the
// Attendance scanner reads. The learner ID is already shown on the roster, so
// the code carries nothing secret; it only says who the learner is.
//
// Print opens a small printable page with just the card, so the teacher can
// print one pass per learner on plain paper.
import { Component, effect, input, output, signal } from '@angular/core';
import { downloadBlob } from '../core/helpers';
import { IconComponent } from './icon.component';
import { ModalComponent } from './modal.component';

// Only the fields a pass card shows, so both the learner directory and a
// class's enrolled list can open it.
export interface QrLearner {
  first_name: string;
  last_name: string;
  learner_id: string;
}

@Component({
  selector: 'app-qr-card',
  imports: [IconComponent, ModalComponent],
  template: `
    <app-modal
      [title]="'QR pass · ' + learner().first_name + ' ' + learner().last_name"
      (closed)="closed.emit()"
    >
      <div class="qr-card">
        @if (qrUrl()) {
          <img class="qr-img" [src]="qrUrl()" alt="QR code for {{ learner().learner_id }}" />
        } @else {
          <p class="muted">Making the QR code…</p>
        }
        <p class="qr-name">{{ learner().last_name }}, {{ learner().first_name }}</p>
        <p class="qr-id mono">{{ learner().learner_id }}</p>
        @if (classLabel()) {
          <p class="qr-class">{{ classLabel() }}</p>
        }
        <p class="muted">Show this pass to the camera on the Attendance page to check in.</p>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary" (click)="printCard()" [disabled]="!qrUrl()">
          <app-icon name="printer" [size]="16" /> Print card
        </button>
        <button type="button" class="btn" (click)="downloadCard()" [disabled]="!qrUrl()">
          <app-icon name="download" [size]="16" /> Download PNG
        </button>
      </div>
    </app-modal>
  `,
  styles: `
    .qr-card {
      text-align: center;
      padding: 8px 0 4px;
    }

    .qr-img {
      width: 220px;
      height: 220px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: #fff;
      padding: 8px;
    }

    .qr-name {
      font-family: var(--font-serif);
      font-size: 20px;
      font-weight: 700;
      margin: 12px 0 0;
    }

    .qr-id {
      font-size: 14px;
      margin: 2px 0 0;
    }

    .qr-class {
      font-size: 13px;
      color: var(--muted);
      margin: 4px 0 0;
    }

    .modal-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 16px;
    }
  `,
})
export class QrCardComponent {
  readonly learner = input.required<QrLearner>();
  readonly classLabel = input('');
  readonly closed = output<void>();

  protected readonly qrUrl = signal<string>('');

  constructor() {
    // Rebuilds the code whenever a different learner is shown. The QR
    // library loads only when a card actually opens, so the Classes page
    // does not carry it; a card opened for one learner while the library
    // is still loading never shows another learner's code.
    effect(() => {
      const learner = this.learner();
      this.qrUrl.set('');
      const learnerId = learner.learner_id;
      void import('qrcode')
        .then((module) =>
          module.default.toDataURL(`acadsync:${learnerId}`, {
            width: 220,
            margin: 1,
            color: { dark: '#2b1a0e', light: '#ffffff' },
          }),
        )
        .then((url) => {
          if (this.learner().learner_id === learnerId) this.qrUrl.set(url);
        })
        .catch(() => undefined);
    });
  }

  protected printCard(): void {
    const url = this.qrUrl();
    if (!url) return;
    const learner = this.learner();
    const page = window.open('', '_blank', 'width=420,height=560');
    if (!page) return;
    page.document.write(
      '<!doctype html><html><head><meta charset="utf-8"><title>QR pass · ' +
        learner.first_name +
        ' ' +
        learner.last_name +
        '</title><style>' +
        'body{font-family:Georgia,serif;text-align:center;padding:32px 16px;color:#2b1a0e}' +
        'img{width:260px;height:260px;border:1px solid #d5c29e;border-radius:12px;padding:8px}' +
        'h1{font-size:22px;margin:14px 0 0}.id{font-family:monospace;font-size:15px;margin:4px 0 0}' +
        '.cls{font-size:13px;color:#5d4630;margin:6px 0 0}p{font-size:12px;color:#5d4630}' +
        '</style></head><body>' +
        '<img src="' +
        url +
        '" alt="QR code">' +
        '<h1>' +
        learner.last_name +
        ', ' +
        learner.first_name +
        '</h1>' +
        '<p class="id">' +
        learner.learner_id +
        '</p>' +
        (this.classLabel() ? '<p class="cls">' + this.classLabel() + '</p>' : '') +
        '<p>AcadSync attendance pass</p>' +
        '<script>window.onload=function(){window.print();}</script>' +
        '</body></html>',
    );
    page.document.close();
  }

  protected downloadCard(): void {
    const url = this.qrUrl();
    if (!url) return;
    fetch(url)
      .then((response) => response.blob())
      .then((blob) => downloadBlob(blob, `qr-${this.learner().learner_id}.png`));
  }
}
