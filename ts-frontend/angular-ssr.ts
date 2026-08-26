import { Component, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser, isPlatformServer } from '@angular/common';
import { getEnvVar } from './env-config';

// Angular Universal component with type-safe platform detection for ECS Fargate SSR
// Integrates AWS SSM Parameter Store SSR feature flags for container-safe platform checks
@Component({ selector: 'app-root', template: '' })
export class AppComponent {
  private readonly ssrEnabled: boolean;
  private readonly platformType: 'browser' | 'server' | 'unknown';

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    // Type-safe platform detection with SSR feature flag from AWS SSM Parameter Store
    // Environment variable SSR_ENABLED injected from ECS Fargate task definition
    // Using type-safe environment variable access with runtime validation
    this.ssrEnabled = getEnvVar('SSR_ENABLED');
    
    // Determine platform type with type-safe guards
    if (isPlatformBrowser(this.platformId)) {
      this.platformType = 'browser';
    } else if (isPlatformServer(this.platformId)) {
      this.platformType = 'server';
    } else {
      this.platformType = 'unknown';
    }
  }

  ngOnInit(): void {
    // Type-safe browser API access with platform checks for SSR compatibility
    // Prevents container crashes during SSR in Kubernetes/ECS Fargate pods
    if (this.platformType === 'browser' && isPlatformBrowser(this.platformId)) {
      // Safe to access browser-only APIs
      const width = window.innerWidth;
      console.log('Browser platform detected, width:', width);
    } else if (this.platformType === 'server' && this.ssrEnabled) {
      // SSR mode - avoid browser APIs
      console.log('Server-side rendering mode active');
    }
  }

  // Type-safe helper method for platform-specific logic
  private isBrowserPlatform(): boolean {
    return this.platformType === 'browser' && isPlatformBrowser(this.platformId);
  }

  // Type-safe helper method for SSR-specific logic
  private isServerPlatform(): boolean {
    return this.platformType === 'server' && isPlatformServer(this.platformId);
  }
}
