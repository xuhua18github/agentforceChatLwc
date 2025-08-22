import { LightningElement, api } from 'lwc';
import { wire } from 'lwc';
import USER_ID from '@salesforce/user/Id';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import USER_FIRST_NAME from '@salesforce/schema/User.FirstName';
import USER_LAST_NAME from '@salesforce/schema/User.LastName';
import USER_EMAIL from '@salesforce/schema/User.Email';

export default class MiawLauncher extends LightningElement {
  @api orgUrl = 'https://YOUR_DOMAIN.my.salesforce.com';
  @api siteUrl = 'https://YOUR_EXPERIENCE_SITE_URL';
  @api gslbBaseUrl = null;
  @api salesforceOrgId = '00DXXXXXXXXXXXX';
  @api deploymentName = 'YOUR_DEPLOYMENT_NAME';
  @api scrt2Url = 'https://YOUR_EXPERIENCE_SITE_URL/ESW_Messaging';
  @api buttonLabel = 'Contact support';
  @api useDefaultLauncher = false;
  @api prechatFirstNameLabel = 'First Name';
  @api prechatLastNameLabel = 'Last Name';
  @api prechatEmailLabel = 'Email';

  _scriptLoading = false;
  _scriptLoaded = false;
  _userLoaded = false;

  _userFirstName;
  _userLastName;
  _userEmail;

  @wire(getRecord, { recordId: USER_ID, fields: [USER_FIRST_NAME, USER_LAST_NAME, USER_EMAIL] })
  wiredUser({ data, error }) {
    if (data) {
      this._userFirstName = getFieldValue(data, USER_FIRST_NAME);
      this._userLastName = getFieldValue(data, USER_LAST_NAME);
      this._userEmail = getFieldValue(data, USER_EMAIL);
      this._userLoaded = true;
    } else if (error) {
      this._userLoaded = true;
    }
  }

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

      // Pre-populate Messaging pre-chat fields as HIDDEN (not visible to end users)
      this.applyPrechatSettings();

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

  applyPrechatSettings() {
    try {
      const firstName = this._userFirstName || '';
      const lastName = this._userLastName || '';
      const email = this._userEmail || '';
      const hasAny = firstName || lastName || email;

      if (window.embedded_svc && hasAny) {
        // Use extraPrechatFormDetails to send hidden values to the agent/session
        window.embedded_svc.settings.extraPrechatFormDetails = [
          { label: this.prechatFirstNameLabel, value: firstName, displayToAgent: true },
          { label: this.prechatLastNameLabel, value: lastName, displayToAgent: true },
          { label: this.prechatEmailLabel, value: email, displayToAgent: true }
        ];
      }

      // If the org uses Embedded Messaging bootstrap elsewhere, set HIDDEN prechat fields when ready
      if (window.embeddedservice_bootstrap && typeof window.embeddedservice_bootstrap.prechatAPI?.setHiddenPrechatFields === 'function') {
        window.addEventListener('onEmbeddedMessagingReady', () => {
          window.embeddedservice_bootstrap.prechatAPI.setHiddenPrechatFields({
            FirstName: { value: firstName },
            LastName: { value: lastName },
            Email: { value: email }
          });
        });
      }
    } catch (e) {
      // swallow
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