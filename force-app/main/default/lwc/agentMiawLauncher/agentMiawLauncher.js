import { LightningElement, api } from 'lwc';
import { wire } from 'lwc';
import USER_ID from '@salesforce/user/Id';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import USER_FIRST_NAME from '@salesforce/schema/User.FirstName';
import USER_LASTNAME from '@salesforce/schema/User.LastName';
import USER_EMAIL from '@salesforce/schema/User.Email';
import getAccessToken from '@salesforce/apex/MessagingCredentialController.getAccessToken';

export default class AgentMiawLauncher extends LightningElement {
  @api orgUrl = 'https://YOUR_DOMAIN.my.salesforce.com';
  @api siteUrl = 'https://YOUR_EXPERIENCE_SITE_URL';
  @api salesforceOrgId = '00DXXXXXXXXXXXX';
  @api deploymentName = 'YOUR_DEPLOYMENT_NAME';
  @api scrt2Url = 'https://YOUR_EXPERIENCE_SITE_URL/ESW_Messaging';
  @api buttonLabel = 'Contact support';
  @api identityTokenType = 'OAuth';
  @api accessTokenEndpoint; // Optional HTTP endpoint to fetch { accessToken, serverUrl }
  @api preferApexAccessToken = true; // Use Apex to return access token + server URL
  @api enableSearchMode = false; // Attempt to enable/open search UI if supported

  _scriptLoading = false;
  _scriptLoaded = false;

  _userFirstName;
  _userLastName;
  _userEmail;

  @wire(getRecord, { recordId: USER_ID, fields: [USER_FIRST_NAME, USER_LASTNAME, USER_EMAIL] })
  wiredUser({ data, error }) {
    if (data) {
      this._userFirstName = getFieldValue(data, USER_FIRST_NAME);
      this._userLastName = getFieldValue(data, USER_LASTNAME);
      this._userEmail = getFieldValue(data, USER_EMAIL);
    }
  }

  connectedCallback() {
    this.initEmbeddedMessaging(false);
  }

  handleLaunchClick() {
    if (!this._scriptLoaded) {
      this.initEmbeddedMessaging(true);
    } else {
      this.openMessaging();
    }
  }

  initEmbeddedMessaging(openAfterInit) {
    if (this._scriptLoading) {
      const wait = () => {
        if (this._scriptLoaded) {
          if (openAfterInit) this.openMessaging();
        } else {
          window.setTimeout(wait, 200);
        }
      };
      wait();
      return;
    }

    if (window.embeddedservice_bootstrap && window.embeddedservice_bootstrap.init) {
      this._scriptLoaded = true;
      this.configureAndInit(openAfterInit);
      return;
    }

    this._scriptLoading = true;
    const script = document.createElement('script');
    try {
      const parsedOrgUrl = new URL(this.orgUrl);
      script.src = `${parsedOrgUrl.origin}/embeddedservice/asyncclient/bootstrap.min.js`;
    } catch (e) {
      script.src = 'https://service.force.com/embeddedservice/asyncclient/bootstrap.min.js';
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
      // Optional: set search-related settings if supported
      try {
        if (this.enableSearchMode && window.embeddedservice_bootstrap && window.embeddedservice_bootstrap.settings) {
          // These settings are no-ops if not supported in your org/version
          window.embeddedservice_bootstrap.settings.searchEnabled = true;
        }
      } catch (_ignored) {}

      // Initialize Embedded Messaging (bootstrap)
      window.embeddedservice_bootstrap.init(
        this.salesforceOrgId,
        this.deploymentName,
        this.siteUrl,
        {
          scrt2URL: this.scrt2Url
        }
      );

      // Identity: credential-based user verification
      window.addEventListener('onEmbeddedMessagingReady', async () => {
        await this.setIdentity();
        if (this.enableSearchMode) {
          this.tryOpenSearchUi();
        }
      });
      window.addEventListener('onEmbeddedMessagingIdentityTokenExpired', async () => {
        await this.setIdentity();
      });

      if (openAfterInit) {
        window.setTimeout(() => this.openMessaging(), 50);
      }
    } catch (e) {
      // no-op
    }
  }

  async setIdentity() {
    if (!window.embeddedservice_bootstrap || !window.embeddedservice_bootstrap.userVerificationAPI) {
      return;
    }
    try {
      const identity = await this.fetchAccessToken();
      if (identity && identity.accessToken) {
        const payload = {
          identityTokenType: this.identityTokenType,
          identityToken: identity.accessToken
        };
        if (identity.serverUrl) {
          payload.serverURL = identity.serverUrl;
        }
        window.embeddedservice_bootstrap.userVerificationAPI.setIdentityToken(payload);
      }
    } catch (e) {
      // swallow
    }
  }

  async fetchAccessToken() {
    // Preferred: Apex returns { accessToken, serverUrl }
    if (this.preferApexAccessToken) {
      try {
        const fromApex = await getAccessToken();
        if (fromApex && fromApex.accessToken) {
          return fromApex;
        }
      } catch (e) {
        // fallback to HTTP endpoint
      }
    }
    if (this.accessTokenEndpoint) {
      const response = await fetch(this.accessTokenEndpoint, { credentials: 'include' });
      const text = await response.text();
      try {
        const json = JSON.parse(text);
        return {
          accessToken: json.accessToken || json.token,
          serverUrl: json.serverUrl || json.instanceUrl || json.domain || null
        };
      } catch (_ignored) {
        return { accessToken: text, serverUrl: null };
      }
    }
    return null;
  }

  tryOpenSearchUi() {
    try {
      // Attempt to open a search experience if the API is available in your org/version
      if (window.embeddedservice_bootstrap?.searchAPI && typeof window.embeddedservice_bootstrap.searchAPI.open === 'function') {
        window.embeddedservice_bootstrap.searchAPI.open();
        return;
      }
      if (typeof window.embeddedservice_bootstrap?.openHelpCenter === 'function') {
        window.embeddedservice_bootstrap.openHelpCenter();
      }
    } catch (_ignored) {}
  }

  openMessaging() {
    if (window.embeddedservice_bootstrap && typeof window.embeddedservice_bootstrap.openMessaging === 'function') {
      window.embeddedservice_bootstrap.openMessaging();
    }
  }
}