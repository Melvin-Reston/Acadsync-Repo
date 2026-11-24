// The QR check-in modal (modal-only: there is no in-page scanner panel).
// The device camera is read through @zxing/browser, with Start/Stop controls,
// manual student-ID entry, and a simulate-a-pass-scan control for testing
// without a camera. A scan or ID lookup shows the learner's detail card for
// confirmation BEFORE anything is marked; confirming marks them Present via QR
// for the selected class and date only.
//
// Camera detection: starting a scan first asks the browser for its rear
// (environment-facing) camera, which is the phone camera on a mobile, and
// only falls back to naming a device when the browser cannot honour that.
// Once the camera is running, the label shown is read from the live video
// track itself, so it names the camera actually in use — not the first
// device the browser happened to list (on a phone, before permission is
// granted, that list has blank labels and its first entry is often the
// front camera). When more than one camera is found, a switcher lets the
// teacher pick another one.
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
// Type-only: the scanner library itself is loaded on demand in
// startScanning(), so opening the Attendance page does not download it.
import type { BrowserMultiFormatReader } from '@zxing/browser';
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
  // Every video camera the browser reports, once permission has been
  // granted and the labels are real. Empty until the first scan starts.
  protected readonly cameras = signal<MediaDeviceInfo[]>([]);
  // '' means automatic: let the browser pick its rear camera. Otherwise
  // the deviceId the teacher picked in the camera switcher.
  protected readonly selectedCameraId = signal('');
  // A plain description of the camera actually in use, read from the
  // live video track (for example "Rear camera · Back Camera").
  protected readonly cameraInUse = signal('');
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

  protected async startScanning(deviceId?: string): Promise<void> {
    const video = this.video()?.nativeElement;
    if (!video) return;
    this.cameraError.set('');
    this.scanError.set('');
    this.cameraInUse.set('');
    // A camera needs a secure page: https, or localhost. Over plain http on
    // a local network the browser blocks getUserMedia outright, so say so
    // plainly instead of reporting a missing camera.
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      this.cameraError.set(
        'The camera is blocked because this page is not secure (http). Open AcadSync over https, or use localhost, or type the student ID instead.',
      );
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.cameraError.set('This browser cannot open a camera. Type the student ID instead, or use Simulate a pass scan.');
      return;
    }
    if (this.scanning()) this.stopScanning();
    // The scanner library loads only when a scan actually starts, so the
    // Attendance page itself stays light; a failed load is reported the
    // same way as a missing camera.
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      this.reader = new BrowserMultiFormatReader();
    } catch {
      this.scanning.set(false);
      this.cameraError.set('The camera scanner could not be loaded. Type the student ID instead, or use Simulate a pass scan.');
      return;
    }
    const wanted = deviceId ?? (this.selectedCameraId() || undefined);
    try {
      // No deviceId: @zxing/browser asks for { facingMode: 'environment' },
      // so the browser itself picks the rear camera on a phone. Naming a
      // device here would defeat that — before permission is granted the
      // device list has blank labels, and its first entry is often the
      // front camera, which is why scanning on a phone used to open the
      // selfie camera (or no usable camera at all).
      this.scanControls = await this.decodeFromDevice(wanted, video);
    } catch (error) {
      const name = (error as Error)?.name ?? '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        this.scanning.set(false);
        this.cameraError.set('Camera access was denied. Allow the camera in the browser, or type the student ID instead.');
        return;
      }
      // The browser could not honour the rear-camera request (or no device
      // was named and none could be chosen). Fall back to naming a real
      // device: now that permission has been requested, the list carries
      // real labels, so the rear camera can be picked by name.
      if (!wanted && (name === 'OverconstrainedError' || name === 'NotFoundError')) {
        const devices = await this.loadCameras();
        const back = devices.find((device) => /back|rear|environment/i.test(device.label));
        const fallbackId = back?.deviceId ?? devices[0]?.deviceId;
        if (fallbackId) {
          try {
            this.scanControls = await this.decodeFromDevice(fallbackId, video);
          } catch {
            this.scanning.set(false);
            this.cameraError.set('No camera found on this device. Type the student ID instead, or use Simulate a pass scan.');
            return;
          }
        } else {
          this.scanning.set(false);
          this.cameraError.set('No camera found on this device. Type the student ID instead, or use Simulate a pass scan.');
          return;
        }
      } else {
        this.scanning.set(false);
        if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          this.cameraError.set('No camera found on this device. Type the student ID instead, or use Simulate a pass scan.');
        } else {
          this.cameraError.set('The camera could not be opened. Type the student ID instead, or use Simulate a pass scan.');
        }
        return;
      }
    }
    this.scanning.set(true);
    // Permission is granted now, so the device list has real labels: load
    // it for the camera switcher, then name the camera actually in use.
    await this.loadCameras();
    this.updateCameraInUse(video, wanted);
  }

  // One scan attempt against a named device, or the browser's rear camera
  // when deviceId is undefined.
  private decodeFromDevice(
    deviceId: string | undefined,
    video: HTMLVideoElement,
  ): Promise<{ stop: () => void }> {
    if (!this.reader) throw new Error('Scanner is not ready.');
    return this.reader.decodeFromVideoDevice(deviceId, video, (result, error) => {
      if (result) {
        this.handleCode(result.getText());
      } else if (error && error.name !== 'NotFoundException') {
        // NotFoundException just means no code in this frame; ignore it.
        this.cameraError.set('The camera could not read a code. Try again, or type the student ID instead.');
      }
    });
  }

  private async loadCameras(): Promise<MediaDeviceInfo[]> {
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const devices = await BrowserMultiFormatReader.listVideoInputDevices();
      this.cameras.set(devices);
      return devices;
    } catch {
      return [];
    }
  }

  // Reads the live video track and names the camera it belongs to: the
  // track's facingMode says rear or front, and its label (and the matching
  // enumerated device) names the hardware. Falls back to the device the
  // teacher picked, or to "Camera" when the browser reports nothing.
  private updateCameraInUse(video: HTMLVideoElement, wanted?: string): void {
    const stream = video.srcObject as MediaStream | null;
    const track = stream?.getVideoTracks()[0];
    const settings = track?.getSettings() ?? {};
    const deviceId = settings.deviceId ?? wanted;
    const device = this.cameras().find((camera) => camera.deviceId === deviceId);
    const label = track?.label || device?.label || '';
    if (deviceId) this.selectedCameraId.set(deviceId);
    this.cameraInUse.set(this.cameraDisplayName(settings.facingMode, label));
  }

  protected cameraDisplayName(facingMode: string | undefined, label: string): string {
    const facing = /environment/i.test(facingMode ?? '')
      ? 'Rear camera'
      : /user/i.test(facingMode ?? '')
        ? 'Front camera'
        : /back|rear|environment/i.test(label)
          ? 'Rear camera'
          : /front|user|face/i.test(label)
            ? 'Front camera'
            : '';
    return facing && label && !label.startsWith(facing) ? `${facing} · ${label}` : facing || label || 'Camera';
  }

  // The switcher passes the picked deviceId ('' = automatic rear camera).
  // Restarting with it is what moves the scan to the other camera.
  protected async onCameraSelected(deviceId: string): Promise<void> {
    this.selectedCameraId.set(deviceId);
    await this.startScanning(deviceId || undefined);
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
    this.cameraInUse.set('');
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
