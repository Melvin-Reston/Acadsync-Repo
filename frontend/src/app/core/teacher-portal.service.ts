// The teacher portal's own data: dashboard, profile, plan, announcements, schools.
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Plan, PublicSchool, SchoolForm, TeacherAnnouncement, TeacherDashboard, TeacherHoliday, TeacherInvoicePayment, TeacherInvoiceRow, TeacherMe, TeacherSelf, TeacherSubscription, TodayClass } from './models';

export interface PaymentInfo {
  account_name: string;
  instructions: string;
  has_qr: boolean;
}

export interface TeacherPaymentForm {
  reference_number: string;
  paid_on: string;
  note: string;
  screenshot: File | null;
}

export interface TeacherProfileBody {
  first_name: string;
  last_name: string;
  email: string;
  mobile: string;
  present_address: string;
  region?: string;
  division?: string;
  deped_school_id?: string;
  school_head_name?: string;
}

export interface AdviserBody {
  is_adviser: boolean;
  advisory_grade: number | null;
  advisory_section: string | null;
}

// The school details for the DepEd print forms and the school calendar
// dates for SF2, as edited on the dashboard's My Assignment form. Sent on
// their own to PATCH /teacher/me, which only changes the fields actually
// sent, so the teacher's name and contact details are untouched. An empty
// date clears it back to unset.
export interface SchoolDetailsBody {
  region: string;
  division: string;
  deped_school_id: string;
  classes_start_date: string;
  classes_end_date: string;
}

export interface HolidayBody {
  date: string;
  name: string;
}

@Injectable({ providedIn: 'root' })
export class TeacherPortalService {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/teacher`;
  private readonly publicApi = `${environment.apiUrl}/teacher-auth`;

  // Schools for the sign-up dropdown (public, no sign-in needed).
  schools(): Observable<{ items: PublicSchool[] }> {
    return this.http.get<{ items: PublicSchool[] }>(`${this.publicApi}/schools`);
  }

  // "School not in the list? Add a school" (public, no sign-in needed).
  addSchool(form: SchoolForm): Observable<{ school: PublicSchool }> {
    return this.http.post<{ school: PublicSchool }>(`${this.publicApi}/register/school`, form);
  }

  // Plans for the Choose Plan step (public, no sign-in needed).
  activePlans(): Observable<{ items: Plan[] }> {
    return this.http.get<{ items: Plan[] }>(`${environment.apiUrl}/plans/active`);
  }

  dashboard(): Observable<TeacherDashboard> {
    return this.http.get<TeacherDashboard>(`${this.api}/dashboard`);
  }

  // The teacher's classes today, for the sign-in panel.
  todayClasses(): Observable<{ items: TodayClass[] }> {
    return this.http.get<{ items: TodayClass[] }>(`${this.api}/today-classes`);
  }

  me(): Observable<TeacherMe> {
    return this.http.get<TeacherMe>(`${this.api}/me`);
  }

  updateProfile(body: TeacherProfileBody): Observable<{ teacher: TeacherSelf }> {
    return this.http.patch<{ teacher: TeacherSelf }>(`${this.api}/me`, body);
  }

  updateAdviser(body: AdviserBody): Observable<{ teacher: TeacherSelf }> {
    return this.http.patch<{ teacher: TeacherSelf }>(`${this.api}/me/adviser`, body);
  }

  updateSchoolDetails(body: SchoolDetailsBody): Observable<{ teacher: TeacherSelf }> {
    return this.http.patch<{ teacher: TeacherSelf }>(`${this.api}/me`, body);
  }

  addHoliday(body: HolidayBody): Observable<{ holiday: TeacherHoliday }> {
    return this.http.post<{ holiday: TeacherHoliday }>(`${this.api}/holidays`, body);
  }

  deleteHoliday(holidayId: number): Observable<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(`${this.api}/holidays/${holidayId}`);
  }

  subscription(): Observable<{ subscription: TeacherSubscription | null }> {
    return this.http.get<{ subscription: TeacherSubscription | null }>(`${this.api}/subscription`);
  }

  // Choose Plan: starts the teacher's subscription.
  choosePlan(planId: number): Observable<{ subscription: TeacherSubscription }> {
    return this.http.post<{ subscription: TeacherSubscription }>(`${this.api}/subscription`, { plan_id: planId });
  }

  announcements(): Observable<{ items: TeacherAnnouncement[] }> {
    return this.http.get<{ items: TeacherAnnouncement[] }>(`${this.api}/announcements`);
  }

  // ---------- Payments & Invoices (Batch 6) ----------

  // The teacher's own invoices, newest first.
  myInvoices(): Observable<{ items: TeacherInvoiceRow[] }> {
    return this.http.get<{ items: TeacherInvoiceRow[] }>(`${this.api}/invoices`);
  }

  // One of the teacher's own invoices, as a receipt, with its payment history.
  myInvoice(id: number): Observable<{ invoice: TeacherInvoiceRow; payments: TeacherInvoicePayment[] }> {
    return this.http.get<{ invoice: TeacherInvoiceRow; payments: TeacherInvoicePayment[] }>(
      `${this.api}/invoices/${id}`,
    );
  }

  // Whose QR code the teacher pays with, and the steps to follow.
  paymentInfo(): Observable<PaymentInfo> {
    return this.http.get<PaymentInfo>(`${this.api}/payment-info`);
  }

  // The QR code image itself (fetched with the teacher token, not by a plain link).
  paymentQr(): Observable<Blob> {
    return this.http.get(`${this.api}/payment-info/qr`, { responseType: 'blob' });
  }

  // Send a QR payment for an invoice: screenshot and reference number.
  // Sent as a form because it carries an image.
  submitPayment(invoiceId: number, form: TeacherPaymentForm): Observable<{ payment: TeacherInvoicePayment; message: string }> {
    const body = new FormData();
    body.append('reference_number', form.reference_number);
    body.append('paid_on', form.paid_on);
    body.append('note', form.note);
    if (form.screenshot) {
      body.append('screenshot', form.screenshot);
    }
    return this.http.post<{ payment: TeacherInvoicePayment; message: string }>(
      `${this.api}/invoices/${invoiceId}/payments`,
      body,
    );
  }

  // Change plan: ends the current subscription and starts a new one.
  changePlan(planId: number): Observable<{ subscription: TeacherSubscription }> {
    return this.http.post<{ subscription: TeacherSubscription }>(`${this.api}/subscription/change-plan`, { plan_id: planId });
  }
}
