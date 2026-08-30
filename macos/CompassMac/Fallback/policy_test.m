#import <Foundation/Foundation.h>

#import "CompassURLPolicy.h"

static void AssertDestination(NSString *value, CompassURLDestination expected) {
    CompassURLDestination actual = CompassDestinationForURL([NSURL URLWithString:value]);
    if (actual != expected) {
        fprintf(stderr, "URL policy failed for %s: expected %ld, got %ld\n", value.UTF8String, (long)expected, (long)actual);
        exit(1);
    }
}

int main(void) {
    @autoreleasepool {
        AssertDestination(@"https://compass-tasks.vercel.app", CompassURLDestinationInApp);
        AssertDestination(@"https://accounts.google.com/o/oauth2/auth", CompassURLDestinationInApp);
        AssertDestination(@"https://secure-token.firebaseapp.com/__/auth/handler", CompassURLDestinationInApp);
        AssertDestination(@"https://review-schedule-splakilop.web.app/__/auth/handler", CompassURLDestinationInApp);
        AssertDestination(@"https://example.org/guide", CompassURLDestinationExternal);
        AssertDestination(@"http://compass-tasks.vercel.app", CompassURLDestinationBlocked);
        AssertDestination(@"file:///tmp/page.html", CompassURLDestinationBlocked);
        puts("Compass URL policy fallback tests passed");
    }
    return 0;
}
