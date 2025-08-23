// Component: AgentMiawLauncher
// Purpose: Launch and host Salesforce Embedded Messaging on an Experience Cloud page.
// Key features:
// - Dynamically loads the Embedded Messaging bootstrap script
// - Uses credential-based user verification via Apex (community session) or HTTP endpoint
// - Optional search bar to seed a subject and send an initial bot message
// - Prechat fields (visible + hidden) are populated programmatically
// - Optional search UI trigger and bot user input toggle
// - Debug logging toggle to aid troubleshooting

import { LightningElement, api } from 'lwc';
import { wire } from 'lwc';
import USER_ID from '@salesforce/user/Id';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import USER_FIRST_NAME from '@salesforce/schema/User.FirstName';
import USER_LASTNAME from '@salesforce/schema/User.LastName';
import USER_EMAIL from '@salesforce/schema/User.Email';
import getAccessToken from '@salesforce/apex/MessagingCredentialController.getAccessToken';

export default class AgentMiawLauncher extends LightningElement {
  // Experience Builder-configurable properties
  @api orgUrl = 'https://YOUR_DOMAIN.my.salesforce.com';
  @api siteUrl = 'https://YOUR_EXPERIENCE_SITE_URL';
  @api salesforceOrgId = '00DXXXXXXXXXXXX';
  @api deploymentName = 'YOUR_DEPLOYMENT_NAME';
  @api scrt2Url = 'https://YOUR_EXPERIENCE_SITE_URL/ESW_Messaging';
  @api buttonLabel = 'Contact support';

  // Identity: credential-based (OAuth) verification
  @api identityTokenType = 'OAuth';
  @api accessTokenEndpoint; // Optional: backend endpoint that returns {accessToken, serverUrl}
  @api preferApexAccessToken; // If undefined, treated as true; set to false to disable Apex fetch

  // Optional UI flags
  @api enableSearchMode = false; // Attempts to open a search/help experience if supported
  @api disableUserInputForBot = false; // When true, blocks user input while a bot is active

  // Optional prechat field API names used by your deployment
  @api prechatSubjectFieldApiName = '_subject';
  @api prechatFirstNameApiName = '_firstName';
  @api prechatLastNameApiName = '_lastName';
  @api prechatEmailApiName = '_email';

  // Debug toggle to emit console logs prefixed with [AgentMiawLauncher]
  @api debug = false;

  // Internal state for script lifecycle
  _scriptLoading = false;
  _scriptLoaded = false;

  // Current user details (for prechat convenience)
  _userFirstName;
  _userLastName;
  _userEmail;

  // Local UI state
  searchQuery = '';
  showContainer = false; // Overlay container toggled when launching via search
  _pendingInitialQuery; // Holds a query typed before messaging is fully ready

  // Wire: fetch minimal user info for prechat population
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

  // On first attachment, load and init Embedded Messaging
  connectedCallback() {
    if (this.debug) console.log('[AgentMiawLauncher] connectedCallback');
    this.initEmbeddedMessaging(false);
  }

  // After render, bind the targetElement so the widget renders inside our container overlay
  renderedCallback() {
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

  // Manual launcher button
  handleLaunchClick() {
    if (this.debug) console.log('[AgentMiawLauncher] handleLaunchClick');
    if (!this._scriptLoaded) {
      this.initEmbeddedMessaging(true);
    } else {
      this.openMessaging();
    }
  }

  // Search input bindings
  handleQueryChange(event) {
    this.searchQuery = event.detail.value;
  }

  // Search button: seed prechat and auto-launch
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

  // Lazy-load bootstrap if needed, then init
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
      // Prefer loading bootstrap from the Embedded Messaging deployment base URL
      const base = (this.siteUrl || '').replace(/\/$/, '');
      script.src = `${base}/assets/js/bootstrap.min.js`;
    } catch (e) {
      // Fallback to generic CDN path if siteUrl is malformed
      script.src = 'https://service.force.com/embeddedservice/asyncclient/bootstrap.min.js';
    }
    if (this.debug) console.log('[AgentMiawLauncher] bootstrap URL', script.src);

    script.onload = () => {
      this._scriptLoaded = true;
      this._scriptLoading = false;
      if (this.debug) console.log('[AgentMiawLauncher] bootstrap loaded');
      this.configureAndInit(openAfterInit);
    };
    script.onerror = () => {
      this._scriptLoading = false;
      if (this.debug) console.error('[AgentMiawLauncher] bootstrap failed to load', script.src);
    };
    document.body.appendChild(script);
  }

  // CSS class toggler for overlay container
  get containerClasses() {
    return `embeddedContainer ${this.showContainer ? 'show' : ''}`.trim();
  }

  // Apply settings, init messaging, and wire identity + event listeners
  configureAndInit(openAfterInit) {
    try {
      if (this.debug) console.log('[AgentMiawLauncher] configureAndInit init');

      // Optional search UI flag (no-op if unsupported by your org/version)
      try {
        if (this.enableSearchMode && window.embeddedservice_bootstrap && window.embeddedservice_bootstrap.settings) {
          window.embeddedservice_bootstrap.settings.searchEnabled = true;
          if (this.debug) console.log('[AgentMiawLauncher] searchEnabled=true');
        }
      } catch (e) {
        if (this.debug) console.warn('[AgentMiawLauncher] searchEnabled set failed', e);
      }

      // Optional: Disable user input while a bot is active
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

      // Identity lifecycle: set token on ready and refresh on expiry
      window.addEventListener('onEmbeddedMessagingReady', async () => {
        if (this.debug) console.log('[AgentMiawLauncher] onEmbeddedMessagingReady');
        await this.setIdentity();
        if (this.enableSearchMode) {
          this.tryOpenSearchUi();
        }
        // If a query was queued prior to ready, launch and send it now
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

  // Provide OAuth identity (credential-based) to Embedded Messaging
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

  // Fetch an access token either from Apex (session) or from a provided endpoint
  async fetchAccessToken() {
    // Treat undefined as true (use metadata default or code fallback)
    const useApex = (this.preferApexAccessToken !== false);

    // Preferred: Apex returns { accessToken, serverUrl } for the current authenticated user
    if (useApex) {
      try {
        const fromApex = await getAccessToken();
        if (this.debug) console.log('[AgentMiawLauncher] getAccessToken (Apex) OK');
        if (fromApex && fromApex.accessToken) {
          return fromApex;
        }
      } catch (e) {
        if (this.debug) console.warn('[AgentMiawLauncher] getAccessToken (Apex) failed', e);
        // fallback to HTTP endpoint if configured
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

  // Configure prechat, launch the chat UI, then send the initial query when the bot joins
  launchWithPrechat(query) {
    try {
      const firstName = this._userFirstName || '';
      const lastName = this._userLastName || '';
      const email = this._userEmail || '';

      // Prechat fields (visible + hidden)
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

      // Launch: shows prechat if enabled or opens chat directly
      if (window.embeddedservice_bootstrap?.utilAPI?.launchChat) {
        window.embeddedservice_bootstrap.utilAPI.launchChat();
        if (this.debug) console.log('[AgentMiawLauncher] utilAPI.launchChat called');
      } else {
        this.openMessaging();
      }

      // Auto-send the initial query to the bot when it appears as a participant
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

  // Optional helper: attempt to open knowledge/help search UI if supported
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

  // Programmatically open the chat widget
  openMessaging() {
    if (window.embeddedservice_bootstrap && typeof window.embeddedservice_bootstrap.openMessaging === 'function') {
      window.embeddedservice_bootstrap.openMessaging();
      if (this.debug) console.log('[AgentMiawLauncher] openMessaging called');
    }
  }
}