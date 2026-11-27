import { DatePipe } from '@angular/common';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/auth.service';
import { errorMessage, fieldErrors, roleLabel } from '../../core/helpers';
import { AdminAccount, FieldErrors, GradingProfileOption, PaymentSettings } from '../../core/models';
import { SystemService } from '../../core/system.service';
import { ToastService } from '../../core/toast.service';
import { DropdownComponent, DropdownOption } from '../../shared/dropdown.component';
import { IconComponent } from '../../shared/icon.component';
import { ModalComponent } from '../../shared/modal.component';
import { TemporaryPasswordComponent } from '../../shared/temporary-password.component';

// Each card on this page has its own "saving" flag, message and field errors.
type Section = 'profile' | 'password' | 'year' | 'grading' | 'account' | 'payment';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

@Component({
  selector: 'app-settings',
  imports: [FormsModule, DatePipe, DropdownComponent, IconComponent, ModalComponent, TemporaryPasswordComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.css',
})
export class SettingsComponent implements OnDestroy {
  protected readonly auth = inject(AuthService);
  private readonly system = inject(SystemService);
  private readonly toast = inject(ToastService);

  protected readonly roleLabel = roleLabel;

  protected profile = { full_name: '', email: '' };
  protected password = { current: '', next: '', confirm: '' };
  protected account = { full_name: '', email: '', is_active: true };
  protected payment = { label: '', account_name: '', instructions: '' };
  protected payment2 = { label: '', account_name: '', instructions: '' };

  protected readonly academicYear = signal('');
  protected readonly gradingProfile = signal('');
  protected readonly gradingProfiles = signal<GradingProfileOption[]>([]);
  protected readonly gradingProfileOptions = computed<DropdownOption[]>(() =>
    this.gradingProfiles().map((profile) => ({ value: profile.code, label: profile.label })),
  );
  // The system the server actually has, so a refused change puts the
  // selector back instead of leaving the refused choice showing.
  private savedGradingProfile = '';
  protected readonly adminAccount = signal<AdminAccount | null>(null);
  protected readonly saving = signal<Section | null>(null);
  protected readonly errorIn = signal<Section | null>(null);
  protected readonly error = signal('');
  protected readonly errors = signal<FieldErrors>({});
  protected readonly confirmReset = signal(false);
  protected readonly temporaryPassword = signal('');

  // Payment QR codes: the first and the optional second (for example, an
  // e-wallet and a bank). One save carries both, so saving one never
  // wipes the other.
  protected readonly hasQr = signal(false);
  protected readonly qrUrl = signal('');
  protected readonly qrFile = signal<File | null>(null);
  protected readonly confirmRemoveQr = signal(false);
  protected readonly hasQr2 = signal(false);
  protected readonly qr2Url = signal('');
  protected readonly qr2File = signal<File | null>(null);
  protected readonly confirmRemoveQr2 = signal(false);

  constructor() {
    const admin = this.auth.admin();
    if (admin) {
      this.profile = { full_name: admin.full_name, email: admin.email };
    }

    this.system.settings().subscribe({
      next: (settings) => {
        this.academicYear.set(settings.academic_year);
        this.gradingProfile.set(settings.grading_profile);
        this.savedGradingProfile = settings.grading_profile;
        this.gradingProfiles.set(settings.grading_profiles);
        this.showPayment(settings.payment);
      },
      error: (error) => this.fail('year', error),
    });

    if (this.auth.isSuperUser()) {
      this.system.adminAccount().subscribe({
        next: (response) => this.showAdminAccount(response.admin),
        error: (error) => this.fail('account', error),
      });
    }
  }

  // ---------- My profile ----------
  protected saveProfile(): void {
    this.start('profile');
    this.auth.updateProfile(this.profile.full_name, this.profile.email).subscribe({
      next: () => this.finish('Profile saved.'),
      error: (error) => this.fail('profile', error),
    });
  }

  // ---------- Change password ----------
  protected changePassword(): void {
    this.start('password');

    if (this.password.next !== this.password.confirm) {
      this.saving.set(null);
      this.errorIn.set('password');
      this.errors.set({ confirm: 'The two passwords do not match.' });
      return;
    }

    this.auth.changePassword(this.password.current, this.password.next).subscribe({
      next: () => {
        this.password = { current: '', next: '', confirm: '' };
        this.finish('Password changed.');
      },
      error: (error) => this.fail('password', error),
    });
  }

  // ---------- Academic year ----------
  protected saveAcademicYear(): void {
    this.start('year');
    this.system.updateAcademicYear(this.academicYear()).subscribe({
      next: () => this.finish('Academic year saved.'),
      error: (error) => this.fail('year', error),
    });
  }

  // ---------- Grading system ----------
  // The grading system for the academic year above: DO 8 (4 quarters),
  // DO 015 adjusted (3 terms, SY 2026-2027), or DO 015 zero-based (3 terms,
  // from SY 2027-2028). Refused while grades have already been filed for
  // that year — filed grades keep the system they were filed under.
  protected saveGradingSystem(): void {
    this.start('grading');
    this.system.updateGradingSystem(this.academicYear(), this.gradingProfile()).subscribe({
      next: (response) => {
        this.gradingProfile.set(response.grading_profile);
        this.savedGradingProfile = response.grading_profile;
        this.finish('Grading system saved.');
      },
      error: (error) => {
        // The change was refused (for example, grades are already filed
        // for the year): show the system that is actually in force.
        this.gradingProfile.set(this.savedGradingProfile);
        this.fail('grading', error);
      },
    });
  }

  protected gradingDescription(code: string): string {
    const profile = this.gradingProfiles().find((item) => item.code === code);
    if (!profile) return '';
    const periods = profile.periods.map((period) => `${profile.period_label} ${period}`).join(', ');
    return `${profile.label} · ${periods} · ${profile.third_label}`;
  }

  // ---------- Payment QR codes ----------
  // Checks the chosen image before it is sent. The server checks it again.
  protected onQrChosen(event: Event, second = false): void {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    if (second) this.qr2File.set(null);
    else this.qrFile.set(null);
    this.errorIn.set(null);
    this.errors.set({});
    if (!file) {
      return;
    }

    let problem = '';
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      problem = 'Upload a PNG, JPG or WEBP image.';
    } else if (file.size > MAX_IMAGE_BYTES) {
      problem = 'The image is too large. The limit is 2 MB.';
    }
    if (problem) {
      this.errorIn.set('payment');
      this.error.set('');
      this.errors.set({ [second ? 'qr_image2' : 'qr_image']: problem });
      return;
    }

    if (second) this.qr2File.set(file);
    else this.qrFile.set(file);
    this.setQrUrl(URL.createObjectURL(file), second);
  }

  protected savePayment(removeQr = false, removeQr2 = false): void {
    this.confirmRemoveQr.set(false);
    this.confirmRemoveQr2.set(false);
    this.start('payment');
    this.system
      .updatePaymentSettings({
        ...this.payment,
        qr_image: removeQr ? null : this.qrFile(),
        remove_qr: removeQr,
        qr2_label: this.payment2.label,
        qr2_account_name: this.payment2.account_name,
        qr2_instructions: this.payment2.instructions,
        qr_image2: removeQr2 ? null : this.qr2File(),
        remove_qr2: removeQr2,
      })
      .subscribe({
        next: (response) => {
          this.showPayment(response.payment);
          this.finish(removeQr || removeQr2 ? 'Payment QR code removed.' : 'Payment details saved.');
        },
        error: (error) => this.fail('payment', error),
      });
  }

  private showPayment(payment: PaymentSettings): void {
    this.payment = {
      label: payment.label || '',
      account_name: payment.account_name,
      instructions: payment.instructions,
    };
    this.payment2 = {
      label: payment.qr2_label || '',
      account_name: payment.qr2_account_name || '',
      instructions: payment.qr2_instructions || '',
    };
    this.hasQr.set(payment.has_qr);
    this.hasQr2.set(payment.has_qr2);
    this.qrFile.set(null);
    this.qr2File.set(null);
    this.setQrUrl('', false);
    this.setQrUrl('', true);

    // The images are only sent to signed-in admins, so they are fetched with the token.
    if (payment.has_qr) {
      this.system.paymentQrImage().subscribe({
        next: (blob) => this.setQrUrl(URL.createObjectURL(blob), false),
        error: () => undefined,
      });
    }
    if (payment.has_qr2) {
      this.system.paymentQr2Image().subscribe({
        next: (blob) => this.setQrUrl(URL.createObjectURL(blob), true),
        error: () => undefined,
      });
    }
  }

  private setQrUrl(url: string, second = false): void {
    const current = second ? this.qr2Url() : this.qrUrl();
    if (current) {
      URL.revokeObjectURL(current);
    }
    if (second) this.qr2Url.set(url);
    else this.qrUrl.set(url);
  }

  ngOnDestroy(): void {
    this.setQrUrl('', false);
    this.setQrUrl('', true);
  }

  // ---------- Admin account (Super User only) ----------
  protected saveAdminAccount(): void {
    this.start('account');
    this.system.updateAdminAccount(this.account).subscribe({
      next: (response) => {
        this.showAdminAccount(response.admin);
        this.finish('Admin account saved.');
      },
      error: (error) => this.fail('account', error),
    });
  }

  protected resetAdminPassword(): void {
    this.confirmReset.set(false);
    this.start('account');
    this.system.resetAdminPassword().subscribe({
      next: (response) => {
        this.showAdminAccount(response.admin);
        this.saving.set(null);
        this.temporaryPassword.set(response.temporary_password);
      },
      error: (error) => this.fail('account', error),
    });
  }

  protected unlockAdminAccount(): void {
    this.start('account');
    this.system.unlockAdminAccount().subscribe({
      next: (response) => {
        this.showAdminAccount(response.admin);
        this.finish('Admin account unlocked.');
      },
      error: (error) => this.fail('account', error),
    });
  }

  // ---------- Small shared steps ----------
  private showAdminAccount(admin: AdminAccount): void {
    this.account = { full_name: admin.full_name, email: admin.email, is_active: admin.is_active };
    this.adminAccount.set(admin);
  }

  private start(section: Section): void {
    this.saving.set(section);
    this.errorIn.set(null);
    this.error.set('');
    this.errors.set({});
  }

  private finish(message: string): void {
    this.saving.set(null);
    this.toast.success(message);
  }

  private fail(section: Section, error: unknown): void {
    this.saving.set(null);
    this.errorIn.set(section);
    this.errors.set(fieldErrors(error));
    this.error.set(errorMessage(error));
  }
}
