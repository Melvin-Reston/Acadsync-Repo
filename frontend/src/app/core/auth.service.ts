// Signing in and out, and remembering who is signed in.
import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { Admin } from './models';

const TOKEN_KEY = 'acadsync_admin_token';

interface SessionResponse {
  token: string;
  admin: Admin;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly api = `${environment.apiUrl}/auth`;

  private readonly currentAdmin = signal<Admin | null>(null);

  readonly admin = this.currentAdmin.asReadonly();
  readonly isSuperUser = computed(() => this.currentAdmin()?.role === 'super_user');

  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  login(email: string, password: string): Observable<SessionResponse> {
    return this.http
      .post<SessionResponse>(`${this.api}/login`, { email, password })
      .pipe(tap((session) => this.startSession(session)));
  }

  // Asks the API who the saved token belongs to (used after a page refresh).
  loadCurrentAdmin(): Observable<{ admin: Admin }> {
    return this.http
      .get<{ admin: Admin }>(`${this.api}/me`)
      .pipe(tap((response) => this.currentAdmin.set(response.admin)));
  }

  updateProfile(fullName: string, email: string): Observable<{ admin: Admin }> {
    return this.http
      .patch<{ admin: Admin }>(`${this.api}/me`, { full_name: fullName, email })
      .pipe(tap((response) => this.currentAdmin.set(response.admin)));
  }

  changePassword(currentPassword: string, newPassword: string): Observable<SessionResponse> {
    return this.http
      .post<SessionResponse>(`${this.api}/change-password`, {
        current_password: currentPassword,
        new_password: newPassword,
      })
      .pipe(tap((session) => this.startSession(session)));
  }

  forgotPassword(email: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.api}/forgot-password`, { email });
  }

  resetPassword(token: string, newPassword: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.api}/reset-password`, {
      token,
      new_password: newPassword,
    });
  }

  logout(): void {
    // Tell the API (for the activity log), then clear the session either way.
    this.http.post(`${this.api}/logout`, {}).subscribe({
      next: () => this.endSession(),
      error: () => this.endSession(),
    });
  }

  // Clears the saved session and returns to the sign-in page.
  endSession(): void {
    localStorage.removeItem(TOKEN_KEY);
    this.currentAdmin.set(null);
    this.router.navigate(['/login']);
  }

  private startSession(session: SessionResponse): void {
    localStorage.setItem(TOKEN_KEY, session.token);
    this.currentAdmin.set(session.admin);
  }
}
