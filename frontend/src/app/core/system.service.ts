// Overview, activity log, settings and the Admin account (Super User only).
import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { toParams } from './helpers';
import { ActivityPage, AdminAccount, Overview, PaymentSettings, Settings } from './models';

export interface ActivityFilters {
  search: string;
  action: string;
  admin_id: number | null;
  from: string;
  to: string;
  page: number;
  page_size: number;
}

@Injectable({ providedIn: 'root' })
export class SystemService {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;

  // Shown in the top bar; kept here so it updates everywhere when it is changed.
  readonly academicYear = signal('');

  overview(): Observable<Overview> {
    return this.http.get<Overview>(`${this.api}/overview`);
  }

  activity(filters: ActivityFilters): Observable<ActivityPage> {
    return this.http.get<ActivityPage>(`${this.api}/activity`, { params: toParams({ ...filters }) });
  }

  settings(): Observable<Settings> {
    return this.http
      .get<Settings>(`${this.api}/settings`)
      .pipe(tap((settings) => this.academicYear.set(settings.academic_year)));
  }

  updateAcademicYear(academicYear: string): Observable<Settings> {
    return this.http
      .put<Settings>(`${this.api}/settings/academic-year`, { academic_year: academicYear })
      .pipe(tap((settings) => this.academicYear.set(settings.academic_year)));
  }

  // Sets the grading system for one academic year (DO 8, DO 015 adjusted,
  // or DO 015 zero-based). Refused while grades have already been filed for
  // that year: filed grades keep the system they were filed under.
  updateGradingSystem(
    academicYear: string,
    profile: string,
  ): Observable<{ academic_year: string; grading_profile: string; grading: Settings['grading'] }> {
    return this.http.put<{ academic_year: string; grading_profile: string; grading: Settings['grading'] }>(
      `${this.api}/settings/grading-system`,
      { academic_year: academicYear, profile },
    );
  }

  // Saves the payment QR code, account name and instructions. Sent as a form because it can carry an image.
  updatePaymentSettings(values: {
    account_name: string;
    instructions: string;
    qr_image: File | null;
    remove_qr: boolean;
  }): Observable<{ payment: PaymentSettings }> {
    const form = new FormData();
    form.append('account_name', values.account_name);
    form.append('instructions', values.instructions);
    form.append('remove_qr', String(values.remove_qr));
    if (values.qr_image) {
      form.append('qr_image', values.qr_image);
    }
    return this.http.put<{ payment: PaymentSettings }>(`${this.api}/settings/payment`, form);
  }

  paymentQrImage(): Observable<Blob> {
    return this.http.get(`${this.api}/settings/payment/qr`, { responseType: 'blob' });
  }

  adminAccount(): Observable<{ admin: AdminAccount }> {
    return this.http.get<{ admin: AdminAccount }>(`${this.api}/admin-account`);
  }

  updateAdminAccount(form: {
    full_name: string;
    email: string;
    is_active: boolean;
  }): Observable<{ admin: AdminAccount }> {
    return this.http.patch<{ admin: AdminAccount }>(`${this.api}/admin-account`, form);
  }

  resetAdminPassword(): Observable<{ admin: AdminAccount; temporary_password: string }> {
    return this.http.post<{ admin: AdminAccount; temporary_password: string }>(
      `${this.api}/admin-account/reset-password`,
      {},
    );
  }

  unlockAdminAccount(): Observable<{ admin: AdminAccount }> {
    return this.http.post<{ admin: AdminAccount }>(`${this.api}/admin-account/unlock`, {});
  }
}
