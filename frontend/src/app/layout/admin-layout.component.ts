// The frame around every admin page: sidebar on the left, top bar, then the page itself.
import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { initials, roleLabel } from '../core/helpers';
import { SystemService } from '../core/system.service';
import { ThemeService } from '../core/theme.service';
import { IconComponent } from '../shared/icon.component';

interface NavItem {
  label: string;
  path: string;
  icon: string;
}

@Component({
  selector: 'app-admin-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, DatePipe, IconComponent],
  templateUrl: './admin-layout.component.html',
  styleUrl: './admin-layout.component.css',
})
export class AdminLayoutComponent {
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);
  protected readonly system = inject(SystemService);

  protected readonly today = new Date();
  protected readonly drawerOpen = signal(false);

  protected readonly navGroups: { label: string; items: NavItem[] }[] = [
    { label: 'Overview', items: [{ label: 'Overview', path: '/overview', icon: 'grid' }] },
    {
      label: 'Directory',
      items: [
        { label: 'Teachers', path: '/teachers', icon: 'users' },
        { label: 'Schools', path: '/schools', icon: 'school' },
      ],
    },
    {
      label: 'Billing',
      items: [
        { label: 'Subscriptions', path: '/subscriptions', icon: 'card' },
        { label: 'Payments & Invoices', path: '/payments', icon: 'receipt' },
        { label: 'Plans & Packages', path: '/plans', icon: 'layers' },
      ],
    },
    { label: 'Insights', items: [{ label: 'Reports', path: '/reports', icon: 'chart' }] },
    {
      label: 'System',
      items: [
        { label: 'Announcements', path: '/announcements', icon: 'megaphone' },
        { label: 'Activity Log', path: '/activity', icon: 'list' },
        { label: 'Settings', path: '/settings', icon: 'settings' },
      ],
    },
  ];

  protected readonly roleLabel = roleLabel;
  protected readonly initials = initials;

  constructor() {
    // Loads the academic year for the top bar.
    this.system.settings().subscribe({ error: () => undefined });
  }

  protected closeDrawer(): void {
    this.drawerOpen.set(false);
  }
}
