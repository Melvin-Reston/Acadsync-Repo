// The frame around the sign-in, create-account, forgot-password and reset-password pages.
// Two variants, chosen with the `variant` input:
// - "teacher": the rich brand panel from the earlier teacher login design — tagline, description,
//   today-classes card, three feature rows and the systems line, in warm paper / burnt-orange.
// - "admin" (default): the simple panel the admin pages always had — tagline and footer text only.
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { ThemeService } from '../core/theme.service';
import { TeacherAuthService } from '../core/teacher-auth.service';
import { TeacherPortalService } from '../core/teacher-portal.service';
import { ToastService } from '../core/toast.service';
import { time12 } from '../core/helpers';
import { TodayClass } from '../core/models';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-auth-shell',
  imports: [IconComponent],
  template: `
    <div class="auth-page" [class.teacher-auth]="variant() === 'teacher'">
      <header class="auth-topbar">
        <div class="topbar-brand">
          <span class="topbar-mark">A</span>
          <span class="wordmark">AcadSync</span>
          <span class="v-divider" aria-hidden="true"></span>
          <span class="dept">{{ brandSub() }}</span>
        </div>
        <button
          type="button"
          class="theme-toggle"
          [attr.aria-label]="theme.theme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
          (click)="theme.toggle()"
        >
          <app-icon [name]="theme.theme() === 'dark' ? 'sun' : 'moon'" [size]="16" />
          <span>{{ theme.theme() === 'dark' ? 'Light mode' : 'Dark mode' }}</span>
        </button>
      </header>

      <main class="auth-layout">
        <div class="auth-shell-card">
          <aside class="auth-brand">
            <div class="brand">
              <div class="brand-mark">A</div>
              <div>
                <div class="brand-name">AcadSync</div>
                <div class="brand-sub">{{ brandSub() }}</div>
              </div>
            </div>

            <h2 class="auth-tagline">Every class,<br /><em>in sync.</em></h2>

            @if (variant() === 'teacher') {
              <p class="auth-lede">
                Your teacher workspace for classes, grades, and attendance — rosters, schedules, and
                records kept together in one place.
              </p>

              <div class="today-card">
                <div class="today-head">Today · Classes</div>
                @if (todayClasses().length === 0) {
                  <p class="today-empty">No classes yet</p>
                } @else {
                  @for (cls of todayClasses(); track cls.id) {
                    <div class="today-row">
                      <app-icon name="school" [size]="16" />
                      <div class="today-class">
                        <b>{{ cls.title }}</b>
                        <span>{{ cls.room }} · {{ time12(cls.start_time) }} – {{ time12(cls.end_time) }}</span>
                      </div>
                      <span class="pill plain" [class.now]="cls.status === 'now'" [class.next]="cls.status === 'next'">
                        {{ cls.status === 'now' ? 'Now' : 'Next' }}
                      </span>
                    </div>
                  }
                }
              </div>

              <ul class="auth-features">
                <li>
                  <span class="feature-icon"><app-icon name="users" [size]="16" /></span>
                  <div>
                    <b>Class rosters at a glance</b>
                    <span>See every section you handle, with learner lists ready.</span>
                  </div>
                </li>
                <li>
                  <span class="feature-icon"><app-icon name="check" [size]="16" /></span>
                  <div>
                    <b>Grades &amp; attendance together</b>
                    <span>Record marks and daily attendance without switching tools.</span>
                  </div>
                </li>
                <li>
                  <span class="feature-icon"><app-icon name="megaphone" [size]="16" /></span>
                  <div>
                    <b>Schedule &amp; announcements</b>
                    <span>Your timetable and school notices, always up to date.</span>
                  </div>
                </li>
              </ul>

              <div class="auth-status">
                <span class="status-dot" aria-hidden="true"></span> All systems operational
              </div>
            } @else {
              <p class="auth-foot">{{ foot() }}</p>
            }
          </aside>

          <section class="auth-form">
            <div class="eyebrow">{{ eyebrow() }}</div>
            <h1 class="page-title">{{ heading() }}</h1>
            @if (subheading()) {
              <p class="auth-sub">{{ subheading() }}</p>
            }
            <ng-content />
          </section>
        </div>
      </main>

      <footer class="auth-page-foot">
        <span>{{ variant() === 'teacher' ? 'Teacher portal' : 'Admin console' }}</span>
        @if (variant() === 'teacher') {
          <button type="button" class="foot-link" (click)="contactAdmin()">Contact Administrator</button>
        } @else {
          <span>Authorized administrators only</span>
        }
      </footer>
    </div>
  `,
})
export class AuthShellComponent implements OnInit {
  readonly heading = input.required<string>();
  readonly subheading = input('');
  // Admin pages use the defaults; teacher pages pass "Teacher Portal".
  readonly brandSub = input('Admin Console');
  readonly eyebrow = input('Admin Console');
  readonly foot = input('Authorized administrators only');
  readonly variant = input<'admin' | 'teacher'>('admin');

  protected readonly theme = inject(ThemeService);
  private readonly teacherAuth = inject(TeacherAuthService);
  private readonly portal = inject(TeacherPortalService);
  private readonly toasts = inject(ToastService);

  // The teacher's classes today, from the teacher's real meetings (Batch 2).
  // Empty when the teacher has no classes today.
  protected readonly todayClasses = signal<TodayClass[]>([]);
  protected readonly time12 = time12;

  ngOnInit(): void {
    // The sign-in page has no teacher token yet, so the card stays on "No classes yet"
    // there; after sign-up the signed-in teacher's real classes can load here.
    if (this.variant() === 'teacher' && this.teacherAuth.token) {
      this.portal.todayClasses().subscribe({
        next: (response) => this.todayClasses.set(response.items),
        error: () => this.todayClasses.set([]),
      });
    }
  }

  protected contactAdmin(): void {
    this.toasts.success('Locked out or need help? Ask your school administrator — have your username ready.');
  }
}
