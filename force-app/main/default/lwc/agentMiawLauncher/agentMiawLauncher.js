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
  @api disableUserInputForBot = false; // mirrors enableUserInputForConversationWithBot=false
  @api prechatSubjectFieldApiName = '_subject';
  @api prechatFirstNameApiName = '_firstName';
  @api prechatLastNameApiName = '_lastName';
  @api prechatEmailApiName = '_email';
  @api debug = false; // enable console logs

  _scriptLoading = false;
  _scriptLoaded = false;

  _userFirstName;
  _userLastName;
  _userEmail;

  searchQuery = '';
  showContainer = true;
  _pendingInitialQuery;

  @wire(getRecord, { recordId: USER_ID, fields: [USER_FIRST_NAME, USER_LASTNAME, USER_EMAIL] })
  wiredUser({ data, error }) {
    if (data) {
      this._userFirstName = getFieldValue(data, USER_FIRST_NAME);
      this._userLastName = getFieldValue(data, USER_LASTNAME);
      this._userEmail = getFieldValue(data, USER_EMAIL);
      if (this.debug) console.log('[AgentMiawLauncher] Wired user loaded');
    } else if (error) {
      if (this.debug) console.warn('[AgentMiawLauncher] Wired user error', error);
    }
  }

  connectedCallback() {
    if (this.debug) console.log('[AgentMiawLauncher] connectedCallback');
    this.initEmbeddedMessaging(false);
  }

  renderedCallback() {
    // Attach targetElement to the container in this component once available
    try {
      const container = this.template.querySelector('[data-embedded-container]');
      if (container && window.embeddedservice_bootstrap?.settings) {
        window.embeddedservice_bootstrap.settings.targetElement = container;
        if (this.debug) console.log('[AgentMiawLauncher] targetElement set');
      }
    } catch (e) {
      if (this.debug) console.warn('[AgentMiawLauncher] targetElement set failed', e);
    }
  }

  handleLaunchClick() {
    if (this.debug) console.log('[AgentMiawLauncher] handleLaunchClick');
    if (!this._scriptLoaded) {
      this.initEmbeddedMessaging(true);
    } else {
      this.openMessaging();
    }
  }

  handleQueryChange(event) {
    this.searchQuery = event.detail.value;
  }

  handleSearch = () => {
    const query = (this.searchQuery || '').trim();
    if (!query) {
      if (this.debug) console.warn('[AgentMiawLauncher] Empty query, ignoring');
      return;
    }
    if (this.debug) console.log('[AgentMiawLauncher] handleSearch', query);
    this._pendingInitialQuery = query;
    this.showContainer = true;
    this.launchWithPrechat(query);
  };

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
      if (this.debug) console.log('[AgentMiawLauncher] bootstrap already present');
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
      if (this.debug) console.log('[AgentMiawLauncher] bootstrap loaded');
      this.configureAndInit(openAfterInit);
    };
    script.onerror = () => {
      this._scriptLoading = false;
      if (this.debug) console.error('[AgentMiawLauncher] bootstrap failed to load');
    };
    document.body.appendChild(script);
  }

  get containerClass() {
    return this.showContainer ? 'show' : '';
  }

  configureAndInit(openAfterInit) {
    try {
      if (this.debug) console.log('[AgentMiawLauncher] configureAndInit init');
      // Optional: search mode flag
      try {
        if (this.enableSearchMode && window.embeddedservice_bootstrap && window.embeddedservice_bootstrap.settings) {
          window.embeddedservice_bootstrap.settings.searchEnabled = true;
          if (this.debug) console.log('[AgentMiawLauncher] searchEnabled=true');
        }
      } catch (e) {
        if (this.debug) console.warn('[AgentMiawLauncher] searchEnabled set failed', e);
      }

      // Optional: disable user input for bot
      try {
        if (window.embeddedservice_bootstrap && window.embeddedservice_bootstrap.settings) {
          window.embeddedservice_bootstrap.settings.enableUserInputForConversationWithBot = !this.disableUserInputForBot;
          if (this.debug) console.log('[AgentMiawLauncher] enableUserInputForConversationWithBot', !this.disableUserInputForBot);
        }
      } catch (e) {
        if (this.debug) console.warn('[AgentMiawLauncher] bot input setting failed', e);
      }

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
        if (this.debug) console.log('[AgentMiawLauncher] onEmbeddedMessagingReady');
        await this.setIdentity();
        if (this.enableSearchMode) {
          this.tryOpenSearchUi();
        }
        // If a query was requested before ready, launch and send it now
        if (this._pendingInitialQuery) {
          this.launchWithPrechat(this._pendingInitialQuery);
        }
      });
      window.addEventListener('onEmbeddedMessagingIdentityTokenExpired', async () => {
        if (this.debug) console.log('[AgentMiawLauncher] onIdentityTokenExpired');
        await this.setIdentity();
      });

      if (openAfterInit) {
        window.setTimeout(() => this.openMessaging(), 50);
      }
    } catch (e) {
      if (this.debug) console.error('[AgentMiawLauncher] configureAndInit error', e);
    }
  }

  async setIdentity() {
    if (!window.embeddedservice_bootstrap || !window.embeddedservice_bootstrap.userVerificationAPI) {
      if (this.debug) console.warn('[AgentMiawLauncher] userVerificationAPI not available');
      return;
    }
    try {
      const identity = await this.fetchAccessToken();
      if (this.debug) console.log('[AgentMiawLauncher] setIdentity fetched token', !!identity);
      if (identity && identity.accessToken) {
        const payload = {
          identityTokenType: this.identityTokenType,
          identityToken: identity.accessToken
        };
        if (identity.serverUrl) {
          payload.serverURL = identity.serverUrl;
        }
        window.embeddedservice_bootstrap.userVerificationAPI.setIdentityToken(payload);
        if (this.debug) console.log('[AgentMiawLauncher] identity set');
      }
    } catch (e) {
      if (this.debug) console.error('[AgentMiawLauncher] setIdentity failed', e);
    }
  }

  async fetchAccessToken() {
    // Preferred: Apex returns { accessToken, serverUrl }
    if (this.preferApexAccessToken) {
      try {
        const fromApex = await getAccessToken();
        if (this.debug) console.log('[AgentMiawLauncher] getAccessToken (Apex) OK');
        if (fromApex && fromApex.accessToken) {
          return fromApex;
        }
      } catch (e) {
        if (this.debug) console.warn('[AgentMiawLauncher] getAccessToken (Apex) failed', e);
        // fallback to HTTP endpoint
      }
    }
    if (this.accessTokenEndpoint) {
      try {
        const response = await fetch(this.accessTokenEndpoint, { credentials: 'include' });
        const text = await response.text();
        try {
          const json = JSON.parse(text);
          if (this.debug) console.log('[AgentMiawLauncher] getAccessToken (HTTP JSON) OK');
          return {
            accessToken: json.accessToken || json.token,
            serverUrl: json.serverUrl || json.instanceUrl || json.domain || null
          };
        } catch (_ignored) {
          if (this.debug) console.log('[AgentMiawLauncher] getAccessToken (HTTP text) OK');
          return { accessToken: text, serverUrl: null };
        }
      } catch (e) {
        if (this.debug) console.error('[AgentMiawLauncher] getAccessToken (HTTP) failed', e);
      }
    }
    return null;
  }

  launchWithPrechat(query) {
    try {
      const firstName = this._userFirstName || '';
      const lastName = this._userLastName || '';
      const email = this._userEmail || '';
      if (window.embeddedservice_bootstrap?.prechatAPI) {
        const visible = {};
        if (this.prechatFirstNameApiName) {
          visible[this.prechatFirstNameApiName] = { value: firstName, isEditableByEndUser: false };
        }
        if (this.prechatLastNameApiName) {
          visible[this.prechatLastNameApiName] = { value: lastName, isEditableByEndUser: false };
        }
        if (this.prechatEmailApiName) {
          visible[this.prechatEmailApiName] = { value: email, isEditableByEndUser: false };
        }
        if (this.prechatSubjectFieldApiName && query) {
          visible[this.prechatSubjectFieldApiName] = { value: query, isEditableByEndUser: true };
        }
        window.embeddedservice_bootstrap.prechatAPI.setVisiblePrechatFields(visible);
        window.embeddedservice_bootstrap.prechatAPI.setHiddenPrechatFields({
          Prechat_Language: navigator.language || 'en'
        });
        if (this.debug) console.log('[AgentMiawLauncher] prechat fields set', visible);
      }
      // Launch the chat (shows prechat or chat automatically)
      if (window.embeddedservice_bootstrap?.utilAPI?.launchChat) {
        window.embeddedservice_bootstrap.utilAPI.launchChat();
        if (this.debug) console.log('[AgentMiawLauncher] utilAPI.launchChat called');
      } else {
        this.openMessaging();
      }
      // Send the initial message to the bot when participant changes to Chatbot
      if (query) {
        const handler = (event) => {
          try {
            const payload = JSON.parse(event.detail.conversationEntry.entryPayload);
            const entry = (payload && payload.entries && payload.entries[0]) || null;
            if (entry && entry.operation === 'add' && entry.participant?.role === 'Chatbot') {
              window.embeddedservice_bootstrap?.utilAPI?.sendTextMessage?.(query);
              if (this.debug) console.log('[AgentMiawLauncher] initial message sent');
              window.removeEventListener('onEmbeddedMessagingConversationParticipantChanged', handler);
              this._pendingInitialQuery = null;
            }
          } catch (e) {
            if (this.debug) console.warn('[AgentMiawLauncher] participant handler parse error', e);
          }
        };
        window.addEventListener('onEmbeddedMessagingConversationParticipantChanged', handler);
      }
    } catch (e) {
      if (this.debug) console.error('[AgentMiawLauncher] launchWithPrechat failed', e);
    }
  }

  tryOpenSearchUi() {
    try {
      if (window.embeddedservice_bootstrap?.searchAPI && typeof window.embeddedservice_bootstrap.searchAPI.open === 'function') {
        window.embeddedservice_bootstrap.searchAPI.open();
        if (this.debug) console.log('[AgentMiawLauncher] searchAPI.open called');
        return;
      }
      if (typeof window.embeddedservice_bootstrap?.openHelpCenter === 'function') {
        window.embeddedservice_bootstrap.openHelpCenter();
        if (this.debug) console.log('[AgentMiawLauncher] openHelpCenter called');
      }
    } catch (e) {
      if (this.debug) console.warn('[AgentMiawLauncher] tryOpenSearchUi failed', e);
    }
  }

  openMessaging() {
    if (window.embeddedservice_bootstrap && typeof window.embeddedservice_bootstrap.openMessaging === 'function') {
      window.embeddedservice_bootstrap.openMessaging();
      if (this.debug) console.log('[AgentMiawLauncher] openMessaging called');
    }
  }
}