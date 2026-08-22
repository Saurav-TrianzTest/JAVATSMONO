import { Component, Inject, OnInit, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

// Angular Universal SSR component with type-safe PLATFORM_ID guard
// Remediation: cz-ts-1006 - AWS SSM Parameter Store SSR Feature Flags for ECS Fargate
// SSR platform flags are injected from AWS SSM Parameter Store into ECS Fargate
// Angular Universal tasks to enable type-safe platform detection without browser API crashes.
@Component({ selector: 'app-root', template: '' })
export class AppComponent implements OnInit {
  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  ngOnInit(): void {
    // Type-safe platform detection using isPlatformBrowser guard
    // Prevents browser-only API (window.innerWidth) from crashing during SSR
    // in Kubernetes Angular Universal pods / ECS Fargate tasks
    const width: number = isPlatformBrowser(this.platformId) ? window.innerWidth : 0;
  }
}
