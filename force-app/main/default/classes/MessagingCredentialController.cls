public with sharing class MessagingCredentialController {
	public class IdentityTokenResponse {
		@AuraEnabled public String accessToken;
		@AuraEnabled public String serverUrl;
	}

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