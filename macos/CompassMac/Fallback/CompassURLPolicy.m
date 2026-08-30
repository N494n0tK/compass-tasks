#import "CompassURLPolicy.h"

static NSArray<NSString *> *CompassIdentityDomains(void) {
    static NSArray<NSString *> *domains;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        domains = @[
            @"google.com",
            @"googleusercontent.com",
            @"firebaseapp.com",
            @"web.app",
        ];
    });
    return domains;
}

NSURL *CompassProductionURL(void) {
    return [NSURL URLWithString:@"https://compass-tasks.vercel.app"];
}

static BOOL HostMatchesDomain(NSString *host, NSString *domain) {
    return [host isEqualToString:domain] || [host hasSuffix:[@"." stringByAppendingString:domain]];
}

CompassURLDestination CompassDestinationForURL(NSURL *url) {
    NSString *scheme = url.scheme.lowercaseString;
    NSString *host = url.host.lowercaseString;

    if (![scheme isEqualToString:@"https"] || host.length == 0) {
        return CompassURLDestinationBlocked;
    }

    if ([host isEqualToString:CompassProductionURL().host.lowercaseString]) {
        return CompassURLDestinationInApp;
    }

    for (NSString *domain in CompassIdentityDomains()) {
        if (HostMatchesDomain(host, domain)) {
            return CompassURLDestinationInApp;
        }
    }

    return CompassURLDestinationExternal;
}
