#import <Foundation/Foundation.h>

typedef NS_ENUM(NSInteger, CompassURLDestination) {
    CompassURLDestinationInApp,
    CompassURLDestinationExternal,
    CompassURLDestinationBlocked,
};

FOUNDATION_EXPORT NSURL *CompassProductionURL(void);
FOUNDATION_EXPORT CompassURLDestination CompassDestinationForURL(NSURL *url);
