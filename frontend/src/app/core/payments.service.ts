// Payments & Invoices API.
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { toParams } from './helpers';
import { Invoice, InvoicePage, Payment, PaymentPage } from './models';

export interface InvoiceFilters {
  search: string;
  status: string;
  from: string;
  to: string;
  page: number;
  page_size: number;
}

export interface PaymentFilters {
  search: string;
  status: string;
  source: string;
  from: string;
  to: string;
  page: number;
  page_size: number;
}

export interface PaymentRecord {
  reference_number: string;
  paid_on: string;
  note: string;
  screenshot: File | null;
}

@Injectable({ providedIn: 'root' })
export class PaymentsService {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;

  invoices(filters: InvoiceFilters): Observable<InvoicePage> {
    return this.http.get<InvoicePage>(`${this.api}/invoices`, { params: toParams({ ...filters }) });
  }

  invoice(id: number): Observable<{ invoice: Invoice; payments: Payment[] }> {
    return this.http.get<{ invoice: Invoice; payments: Payment[] }>(`${this.api}/invoices/${id}`);
  }

  voidInvoice(id: number, reason: string): Observable<{ invoice: Invoice }> {
    return this.http.post<{ invoice: Invoice }>(`${this.api}/invoices/${id}/void`, { reason });
  }

  // The admin records a payment by hand. It is sent as a form because it can carry an image.
  recordPayment(invoiceId: number, record: PaymentRecord): Observable<{ payment: Payment; invoice: Invoice }> {
    const form = new FormData();
    form.append('reference_number', record.reference_number);
    form.append('paid_on', record.paid_on);
    form.append('note', record.note);
    if (record.screenshot) {
      form.append('screenshot', record.screenshot);
    }
    return this.http.post<{ payment: Payment; invoice: Invoice }>(
      `${this.api}/invoices/${invoiceId}/payments`,
      form,
    );
  }

  payments(filters: PaymentFilters): Observable<PaymentPage> {
    return this.http.get<PaymentPage>(`${this.api}/payments`, { params: toParams({ ...filters }) });
  }

  // The screenshot is only sent to signed-in admins, so it is fetched with the token, not by a plain link.
  screenshot(paymentId: number): Observable<Blob> {
    return this.http.get(`${this.api}/payments/${paymentId}/screenshot`, { responseType: 'blob' });
  }

  confirm(paymentId: number): Observable<{ payment: Payment }> {
    return this.http.post<{ payment: Payment }>(`${this.api}/payments/${paymentId}/confirm`, {});
  }

  reject(paymentId: number, reason: string): Observable<{ payment: Payment }> {
    return this.http.post<{ payment: Payment }>(`${this.api}/payments/${paymentId}/reject`, {
      reason,
    });
  }
}
