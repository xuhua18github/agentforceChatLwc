import { LightningElement, api } from 'lwc';
import { wire } from 'lwc';
import USER_ID from '@salesforce/user/Id';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import USER_FIRST_NAME from '@salesforce/schema/User.FirstName';
import USER_LASTNAME from '@salesforce/schema/User.LastName';
import USER_EMAIL from '@salesforce/schema/User.Email';
import getJwt from '@salesforce/apex/MessagingJwtController.getJwt';

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
  @api useEmbeddedMessagingBootstrap = false; // When true, use embeddedservice_bootstrap instead of embedded_svc
  @api enableUserVerification = false; // When true, set JWT identity token
  @api identityToken; // Optional static token for testing
  @api tokenEndpoint; // Optional endpoint to fetch JWT (should return {identityToken}|{token}|{jwt}|raw string)
  @api preferApexJwt = false; // When true, fetch JWT from Apex MessagingJwtController

  _scriptLoading = false;
  _scriptLoaded = false;
  _userLoaded = false;

  _userFirstName;
  _userLastName;
  _userEmail;

  @wire(getRecord, { recordId: USER_ID, fields: [USER_FIRST_NAME, USER_LASTNAME, USER_EMAIL] })
  wiredUser({ data, error }) {
    if (data) {
      this._userFirstName = getFieldValue(data, USER_FIRST_NAME);
      this._userLastName = getFieldValue(data, USER_LASTNAME);
      this._userEmail = getFieldValue(data, USER_EMAIL);
      this._userLoaded = true;
    } else if (error) {
      this._userLoaded = true;
    }
  }

  connectedCallback() {
    if (this.enableUserVerification) {
      this.useEmbeddedMessagingBootstrap = true;
      this.setupUserVerificationListeners();
    }
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

    if (!this.useEmbeddedMessagingBootstrap && window.embedded_svc && window.embedded_svc.init) {
      this._scriptLoaded = true;
      this.configureAndInit(openAfterInit);
      return;
    }
    if (this.useEmbeddedMessagingBootstrap && window.embeddedservice_bootstrap && window.embeddedservice_bootstrap.init) {
      this._scriptLoaded = true;
      this.configureAndInit(openAfterInit);
      return;
    }

    this._scriptLoading = true;

    const script = document.createElement('script');
    try {
      const parsedOrgUrl = new URL(this.orgUrl);
      script.src = this.useEmbeddedMessagingBootstrap
        ? `${parsedOrgUrl.origin}/embeddedservice/asyncclient/bootstrap.min.js`
        : `${parsedOrgUrl.origin}/embeddedservice/5.0/esw.min.js`;
    } catch (e) {
      script.src = this.useEmbeddedMessagingBootstrap
        ? 'https://service.force.com/embeddedservice/asyncclient/bootstrap.min.js'
        : 'https://service.force.com/embeddedservice/5.0/esw.min.js';
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
      if (this.useEmbeddedMessagingBootstrap) {
        // Embedded Messaging (bootstrap) path
        // Avoid prechat if JWT identity binding is enabled
        if (!this.enableUserVerification) {
          this.applyPrechatSettingsForBootstrap();
        }
        window.embeddedservice_bootstrap.init(
          this.salesforceOrgId,
          this.deploymentName,
          this.siteUrl,
          {
            scrt2URL: this.scrt2Url
          }
        );
        if (openAfterInit) {
          window.setTimeout(() => this.openMessaging(), 50);
        }
      } else {
        // Legacy embedded service (esw) path
        window.embedded_svc.settings.displayHelpButton = this.useDefaultLauncher;
        window.embedded_svc.settings.enabledFeatures = ['Messaging'];
        window.embedded_svc.settings.entryFeature = 'Messaging';

        // Pre-populate Messaging pre-chat fields as HIDDEN (not visible to end users)
        if (!this.enableUserVerification) {
          this.applyPrechatSettingsForEsw();
        }

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
      }
    } catch (e) {
      // No-op: initialization failure will keep the launcher inactive
    }
  }

  applyPrechatSettingsForEsw() {
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
    } catch (e) {
      // swallow
    }
  }

  applyPrechatSettingsForBootstrap() {
    try {
      const firstName = this._userFirstName || '';
      const lastName = this._userLastName || '';
      const email = this._userEmail || '';
      const hasAny = firstName || lastName || email;
      if (window.embeddedservice_bootstrap && hasAny && typeof window.embeddedservice_bootstrap.prechatAPI?.setHiddenPrechatFields === 'function') {
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

  setupUserVerificationListeners() {
    try {
      // Set token once ready
      window.addEventListener('onEmbeddedMessagingReady', async () => {
        await this.provideIdentityToken();
      });
      // Refresh on expiry
      window.addEventListener('onEmbeddedMessagingIdentityTokenExpired', async () => {
        await this.provideIdentityToken();
      });
    } catch (e) {
      // swallow
    }
  }

  async provideIdentityToken() {
    if (!this.enableUserVerification || !window.embeddedservice_bootstrap || !window.embeddedservice_bootstrap.userVerificationAPI) {
      return;
    }
    try {
      const token = await this.fetchIdentityToken();
      if (token) {
        window.embeddedservice_bootstrap.userVerificationAPI.setIdentityToken({
          identityTokenType: 'JWT',
          identityToken: token
        });
      }
    } catch (e) {
      // swallow
    }
  }

  async fetchIdentityToken() {
    if (this.identityToken) {
      return this.identityToken;
    }
    if (this.preferApexJwt) {
      try {
        const tokenFromApex = await getJwt();
        if (tokenFromApex) {
          return tokenFromApex;
        }
      } catch (e) {
        // fall back to tokenEndpoint if provided
      }
    }
    if (!this.tokenEndpoint) {
      return null;
    }
    const response = await fetch(this.tokenEndpoint, { credentials: 'include' });
    const bodyText = await response.text();
    try {
      const json = JSON.parse(bodyText);
      return json.identityToken || json.token || json.jwt || null;
    } catch (_ignored) {
      return bodyText;
    }
  }

  openMessaging() {
    if (this.useEmbeddedMessagingBootstrap && window.embeddedservice_bootstrap && typeof window.embeddedservice_bootstrap.openMessaging === 'function') {
      window.embeddedservice_bootstrap.openMessaging();
    } else if (window.embedded_svc && typeof window.embedded_svc.openMessaging === 'function') {
      window.embedded_svc.openMessaging();
    } else if (window.embedded_svc && typeof window.embedded_svc.openHelp === 'function') {
      window.embedded_svc.openHelp();
    }
  }
}