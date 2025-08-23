/*************************************
 * MessagingCredentialController
 * Returns an access token and server URL for
 * Embedded Messaging credential-based user verification.
 *
 * This implementation uses the current community user's
 * session (UserInfo.getSessionId()), so ensure the page
 * is authenticated and the class is authorized for the user.
 *************************************/
public with sharing class MessagingCredentialController {
	public class IdentityTokenResponse {
		@AuraEnabled public String accessToken; // OAuth access token used as identityToken
		@AuraEnabled public String serverUrl;  // Base URL of the Salesforce instance
	}

	/**
	 * Returns the current user's access token and server URL.
	 * Throws if invoked as a Guest user since no session exists.
	 */
	@AuraEnabled(cacheable=false)
	public static IdentityTokenResponse getAccessToken() {
		if (UserInfo.getUserType() == 'Guest') {
			throw new AuraHandledException('User not authenticated.');
		}
		IdentityTokenResponse res = new IdentityTokenResponse();
		res.accessToken = UserInfo.getSessionId();
		res.serverUrl = URL.getSalesforceBaseUrl().toExternalForm();
		return res;
	}
}