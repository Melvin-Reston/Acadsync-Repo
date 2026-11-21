// The QR check-in modal (modal-only: there is no in-page scanner panel).
// The device camera is read through @zxing/browser, with Start/Stop controls,
// manual student-ID entry, and a simulate-a-pass-scan control for testing
// without a camera. A scan or ID lookup shows the learner's detail card for
// confirmation BEFORE anything is marked; confirming marks them Present via QR
// for the selected class and date only.
import {
  Component,
  ElementRef,
  OnDestroy,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { AttendanceService } from '../../../core/attendance.service';
import { ToastService } from '../../../core/toast.service';
import { errorMessage, initials, manilaNow, time12 } from '../../../core/helpers';
import {
  AttendanceLookup,
  AttendanceMark,
  AttendanceRow,
  AttendanceStatus,
} from '../../../core/models';
import { IconComponent } from '../../../shared/icon.component';

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  excused: 'Excused',
};

@Component({
  selector: 'app-scan-modal',
  imports: [FormsModule, IconComponent],
  templateUrl: './scan-modal.component.html',
  styleUrl: './scan-modal.component.css',
})
export class ScanModalComponent implements OnDestroy {
  private readonly attendance = inject(AttendanceService);
  private readonly toast = inject(ToastService);

  // The class and date the check-in is for; scanning never marks anything else.
  readonly classId = input.required<number>();
  readonly date = input.required<string>();
  readonly classLabel = input.required<string>();
  // The class roster, so Simulate can pick a learner without a camera.
  readonly learners = input.required<AttendanceRow[]>();

  // The parent updates its roll from this and reloads when the modal closes.
  readonly checkedIn = output<{ learnerId: number; mark: AttendanceMark }>();
  readonly closed = output<void>();

  protected readonly scanning = signal(false);
  protected readonly cameraError = signal('');
  protected readonly scanError = signal('');
  protected readonly manualId = signal('');
  protected readonly scanResult = signal<AttendanceLookup | null>(null);
  protected readonly scanConfirmed = signal(false);
  protected readonly scanMessage = signal('');
  protected readonly lastScan = signal('');
  protected readonly checkingIn = signal(false);
  private reader: BrowserMultiFormatReader | null = null;
  private scanControls: { stop: () => void } | null = null;
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('scanVideo');

  protected readonly time12 = time12;
  protected readonly initials = initials;
  protected readonly statusLabel = STATUS_LABEL;

  ngOnDestroy(): void {
    this.stopScanning();
  }

  protected close(): void {
    this.stopScanning();
    this.closed.emit();
  }

  protected async startScanning(): Promise<void> {
    const video = this.video()?.nativeElement;
    if (!video) return;
    this.cameraError.set('');
    this.scanError.set('');
    try {
      this.reader = new BrowserMultiFormatReader();
      // Prefer the rear camera on a phone; fall back to the first camera.
      const devices = await BrowserMultiFormatReader.listVideoInputDevices();
      const back = devices.find((device) => /back|rear|environment/i.test(device.label));
      const deviceId = back?.deviceId ?? devices[0]?.deviceId;
      if (!deviceId) {
        this.cameraError.set('No camera found on this device. Type the student ID instead, or use Simulate a pass scan.');
        return;
      }
      this.scanning.set(true);
      // Resolves with the scanner controls once the camera is running.
      this.scanControls = await this.reader.decodeFromVideoDevice(deviceId, video, (result, error) => {
        if (result) {
          this.handleCode(result.getText());
        } else if (error && error.name !== 'NotFoundException') {
          // NotFoundException just means no code in this frame; ignore it.
          this.cameraError.set('The camera could not read a code. Try again, or type the student ID instead.');
        }
      });
    } catch (error) {
      this.scanning.set(false);
      const name = (error as Error)?.name ?? '';
      if (name === 'NotAllowedError') {
        this.cameraError.set('Camera access was denied. Allow the camera in the browser, or type the student ID instead.');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        this.cameraError.set('No camera found on this device. Type the student ID instead, or use Simulate a pass scan.');
      } else {
        this.cameraError.set('The camera could not be opened. Type the student ID instead, or use Simulate a pass scan.');
      }
    }
  }

  protected stopScanning(): void {
    try {
      // Stops the scan loop and releases the camera.
      this.scanControls?.stop();
    } catch {
      // The camera was never started.
    }
    this.scanControls = null;
    this.reader = null;
    this.scanning.set(false);
  }

  // For testing without a camera: pretends the first unmarked learner's pass was scanned.
  protected simulateScan(): void {
    const learners = this.learners();
    const next = learners.find((learner) => !learner.mark) ?? learners[0];
    if (!next) return;
    this.handleCode(`acadsync:${next.learner_id}`);
  }

  protected manualCheckIn(): void {
    const code = this.manualId().trim();
    if (!code) return;
    this.handleCode(code);
  }

  private handleCode(code: string): void {
    if (!code.trim()) return;
    this.stopScanning();
    this.scanError.set('');
    this.scanResult.set(null);
    this.scanConfirmed.set(false);
    this.scanMessage.set('');
    this.attendance.lookup(this.classId(), this.date(), code.trim()).subscribe({
      next: (lookup) => {
        this.scanResult.set(lookup);
        if (lookup.mark) {
          this.scanMessage.set(
            lookup.mark.status === 'present'
              ? `Already marked ${STATUS_LABEL[lookup.mark.status]}${lookup.mark.time_in ? ` at ${time12(lookup.mark.time_in)}` : ''}${lookup.mark.method === 'qr' ? ' by QR' : ''}. Confirming again keeps the first check-in.`
              : `Currently marked ${STATUS_LABEL[lookup.mark.status]}. Confirming changes it to Present by QR.`,
          );
        }
      },
      error: (error) => this.scanError.set(errorMessage(error)),
    });
  }

  protected confirmCheckIn(): void {
    const lookup = this.scanResult();
    if (!lookup) return;
    this.checkingIn.set(true);
    this.attendance.checkIn(this.classId(), this.date(), lookup.learner.id).subscribe({
      next: (response) => {
        this.checkingIn.set(false);
        this.scanConfirmed.set(true);
        this.scanMessage.set(response.message);
        this.checkedIn.emit({ learnerId: lookup.learner.id, mark: response.mark });
        this.lastScan.set(
          `${lookup.learner.first_name} ${lookup.learner.last_name} · ${time12(response.mark.time_in ?? manilaNow().time)}`,
        );
        this.toast.success(response.message);
      },
      error: (error) => {
        this.checkingIn.set(false);
        this.scanError.set(errorMessage(error));
      },
    });
  }

  protected scanNext(): void {
    this.scanResult.set(null);
    this.scanConfirmed.set(false);
    this.scanMessage.set('');
    this.manualId.set('');
  }
}
