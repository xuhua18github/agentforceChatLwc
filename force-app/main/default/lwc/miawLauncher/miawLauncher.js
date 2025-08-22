import { LightningElement, api } from 'lwc';

export default class MiawLauncher extends LightningElement {
  @api orgUrl = 'https://YOUR_DOMAIN.my.salesforce.com';
  @api siteUrl = 'https://YOUR_EXPERIENCE_SITE_URL';
  @api gslbBaseUrl = null;
  @api salesforceOrgId = '00DXXXXXXXXXXXX';
  @api deploymentName = 'YOUR_DEPLOYMENT_NAME';
  @api scrt2Url = 'https://YOUR_EXPERIENCE_SITE_URL/ESW_Messaging';
  @api buttonLabel = 'Contact support';
  @api useDefaultLauncher = false;

  _scriptLoading = false;
  _scriptLoaded = false;

  connectedCallback() {
    if (this.useDefaultLauncher) {
      this.initMiaw(false);
    }
  }

  handleLaunchClick() {
    if (!this._scriptLoaded) {
      this.initMiaw(true);
    } else {
      this.openMessaging();
    }
  }

  initMiaw(openAfterInit) {
    if (this._scriptLoading) {
      const checkLoaded = () => {
        if (this._scriptLoaded) {
          if (openAfterInit) {
            this.openMessaging();
          }
        } else {
          window.setTimeout(checkLoaded, 200);
        }
      };
      checkLoaded();
      return;
    }

    if (window.embedded_svc && window.embedded_svc.init) {
      this._scriptLoaded = true;
      this.configureAndInit(openAfterInit);
      return;
    }

    this._scriptLoading = true;

    const script = document.createElement('script');
    try {
      const parsedOrgUrl = new URL(this.orgUrl);
      script.src = `${parsedOrgUrl.origin}/embeddedservice/5.0/esw.min.js`;
    } catch (e) {
      script.src = 'https://service.force.com/embeddedservice/5.0/esw.min.js';
    }

    script.onload = () => {
      this._scriptLoaded = true;
      this._scriptLoading = false;
      this.configureAndInit(openAfterInit);
    };

    script.onerror = () => {
      this._scriptLoading = false;
    };

    document.body.appendChild(script);
  }

  configureAndInit(openAfterInit) {
    try {
      window.embedded_svc.settings.displayHelpButton = this.useDefaultLauncher;
      window.embedded_svc.settings.enabledFeatures = ['Messaging'];
      window.embedded_svc.settings.entryFeature = 'Messaging';

      const gslb = this.gslbBaseUrl || null;

      window.embedded_svc.init(
        this.orgUrl,
        this.siteUrl,
        gslb,
        this.salesforceOrgId,
        this.deploymentName,
        {
          scrt2URL: this.scrt2Url
        }
      );

      if (openAfterInit) {
        window.setTimeout(() => this.openMessaging(), 50);
      }
    } catch (e) {
      // No-op: initialization failure will keep the launcher inactive
    }
  }

  openMessaging() {
    if (window.embedded_svc && typeof window.embedded_svc.openMessaging === 'function') {
      window.embedded_svc.openMessaging();
    } else if (window.embedded_svc && typeof window.embedded_svc.openHelp === 'function') {
      window.embedded_svc.openHelp();
    }
  }
}