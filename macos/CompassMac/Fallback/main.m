#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

#import "CompassURLPolicy.h"

@interface CompassAppDelegate : NSObject <NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate>
@property (strong) NSWindow *window;
@property (strong) WKWebView *webView;
@property (strong) NSProgressIndicator *progressIndicator;
@property (strong) NSTextField *statusLabel;
@end

@implementation CompassAppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];

    NSRect frame = NSMakeRect(0, 0, 1280, 800);
    self.window = [[NSWindow alloc] initWithContentRect:frame
                                               styleMask:(NSWindowStyleMaskTitled |
                                                          NSWindowStyleMaskClosable |
                                                          NSWindowStyleMaskMiniaturizable |
                                                          NSWindowStyleMaskResizable)
                                                 backing:NSBackingStoreBuffered
                                                   defer:NO];
    self.window.title = @"Compass";
    self.window.minSize = NSMakeSize(920, 620);

    NSView *root = [[NSView alloc] initWithFrame:frame];
    root.translatesAutoresizingMaskIntoConstraints = NO;
    self.window.contentView = root;

    NSVisualEffectView *navigationBar = [[NSVisualEffectView alloc] initWithFrame:NSZeroRect];
    navigationBar.material = NSVisualEffectMaterialHeaderView;
    navigationBar.blendingMode = NSVisualEffectBlendingModeWithinWindow;
    navigationBar.state = NSVisualEffectStateActive;
    navigationBar.translatesAutoresizingMaskIntoConstraints = NO;
    [root addSubview:navigationBar];

    NSButton *backButton = [self toolbarButtonWithTitle:@"‹" action:@selector(goBack:) tooltip:@"戻る"];
    NSButton *forwardButton = [self toolbarButtonWithTitle:@"›" action:@selector(goForward:) tooltip:@"進む"];
    NSButton *reloadButton = [self toolbarButtonWithTitle:@"↻" action:@selector(reload:) tooltip:@"再読み込み"];
    NSTextField *title = [NSTextField labelWithString:@"Compass"];
    title.font = [NSFont boldSystemFontOfSize:13];
    self.statusLabel = [NSTextField labelWithString:@""];
    self.statusLabel.textColor = NSColor.secondaryLabelColor;
    self.statusLabel.font = [NSFont systemFontOfSize:11];
    self.statusLabel.hidden = YES;

    NSStackView *toolbarItems = [NSStackView stackViewWithViews:@[backButton, forwardButton, reloadButton, title, self.statusLabel]];
    toolbarItems.orientation = NSUserInterfaceLayoutOrientationHorizontal;
    toolbarItems.alignment = NSLayoutAttributeCenterY;
    toolbarItems.spacing = 9;
    toolbarItems.translatesAutoresizingMaskIntoConstraints = NO;
    [navigationBar addSubview:toolbarItems];

    self.progressIndicator = [[NSProgressIndicator alloc] initWithFrame:NSZeroRect];
    self.progressIndicator.indeterminate = NO;
    self.progressIndicator.minValue = 0;
    self.progressIndicator.maxValue = 1;
    self.progressIndicator.hidden = YES;
    self.progressIndicator.translatesAutoresizingMaskIntoConstraints = NO;
    [root addSubview:self.progressIndicator];

    WKWebViewConfiguration *configuration = [[WKWebViewConfiguration alloc] init];
    configuration.websiteDataStore = [WKWebsiteDataStore defaultDataStore];
    configuration.defaultWebpagePreferences.allowsContentJavaScript = YES;
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = YES;

    self.webView = [[WKWebView alloc] initWithFrame:NSZeroRect configuration:configuration];
    self.webView.navigationDelegate = self;
    self.webView.UIDelegate = self;
    self.webView.allowsBackForwardNavigationGestures = YES;
    self.webView.allowsMagnification = YES;
    self.webView.translatesAutoresizingMaskIntoConstraints = NO;
    [self.webView addObserver:self forKeyPath:@"estimatedProgress" options:NSKeyValueObservingOptionNew context:NULL];
    [root addSubview:self.webView];

    [NSLayoutConstraint activateConstraints:@[
        [navigationBar.leadingAnchor constraintEqualToAnchor:root.leadingAnchor],
        [navigationBar.trailingAnchor constraintEqualToAnchor:root.trailingAnchor],
        [navigationBar.topAnchor constraintEqualToAnchor:root.topAnchor],
        [navigationBar.heightAnchor constraintEqualToConstant:36],
        [toolbarItems.leadingAnchor constraintEqualToAnchor:navigationBar.leadingAnchor constant:12],
        [toolbarItems.trailingAnchor constraintLessThanOrEqualToAnchor:navigationBar.trailingAnchor constant:-12],
        [toolbarItems.centerYAnchor constraintEqualToAnchor:navigationBar.centerYAnchor],
        [self.progressIndicator.leadingAnchor constraintEqualToAnchor:root.leadingAnchor],
        [self.progressIndicator.trailingAnchor constraintEqualToAnchor:root.trailingAnchor],
        [self.progressIndicator.topAnchor constraintEqualToAnchor:navigationBar.bottomAnchor],
        [self.progressIndicator.heightAnchor constraintEqualToConstant:2],
        [self.webView.leadingAnchor constraintEqualToAnchor:root.leadingAnchor],
        [self.webView.trailingAnchor constraintEqualToAnchor:root.trailingAnchor],
        [self.webView.topAnchor constraintEqualToAnchor:self.progressIndicator.bottomAnchor],
        [self.webView.bottomAnchor constraintEqualToAnchor:root.bottomAnchor],
    ]];

    [self loadProductionSite];
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
}

- (void)applicationWillTerminate:(NSNotification *)notification {
    [self.webView removeObserver:self forKeyPath:@"estimatedProgress" context:NULL];
}

- (NSButton *)toolbarButtonWithTitle:(NSString *)title action:(SEL)action tooltip:(NSString *)tooltip {
    NSButton *button = [NSButton buttonWithTitle:title target:self action:action];
    button.bezelStyle = NSBezelStyleTexturedRounded;
    button.font = [NSFont systemFontOfSize:20];
    button.toolTip = tooltip;
    return button;
}

- (void)loadProductionSite {
    self.statusLabel.hidden = YES;
    [self.webView loadRequest:[NSURLRequest requestWithURL:CompassProductionURL()]];
}

- (void)goBack:(id)sender {
    if (self.webView.canGoBack) {
        [self.webView goBack];
    }
}

- (void)goForward:(id)sender {
    if (self.webView.canGoForward) {
        [self.webView goForward];
    }
}

- (void)reload:(id)sender {
    self.statusLabel.hidden = YES;
    if (self.webView.URL == nil) {
        [self loadProductionSite];
    } else {
        [self.webView reload];
    }
}

- (void)showError:(NSError *)error {
    if (error.code == NSURLErrorCancelled) {
        return;
    }

    self.progressIndicator.hidden = YES;
    self.statusLabel.stringValue = error.code == NSURLErrorNotConnectedToInternet
        ? @"オフラインです。接続を確認してください。"
        : @"読み込みに失敗しました。再読み込みしてください。";
    self.statusLabel.hidden = NO;
}

- (void)observeValueForKeyPath:(NSString *)keyPath ofObject:(id)object change:(NSDictionary<NSKeyValueChangeKey,id> *)change context:(void *)context {
    if (object == self.webView && [keyPath isEqualToString:@"estimatedProgress"]) {
        self.progressIndicator.doubleValue = self.webView.estimatedProgress;
    }
}

- (void)webView:(WKWebView *)webView didStartProvisionalNavigation:(WKNavigation *)navigation {
    self.statusLabel.hidden = YES;
    self.progressIndicator.hidden = NO;
    self.progressIndicator.doubleValue = 0.05;
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    self.progressIndicator.doubleValue = 1;
    self.progressIndicator.hidden = YES;
}

- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    [self showError:error];
}

- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    [self showError:error];
}

- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)navigationAction decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    NSURL *url = navigationAction.request.URL;
    CompassURLDestination destination = CompassDestinationForURL(url);

    switch (destination) {
        case CompassURLDestinationInApp:
            if (navigationAction.targetFrame == nil) {
                [webView loadRequest:navigationAction.request];
                decisionHandler(WKNavigationActionPolicyCancel);
            } else {
                decisionHandler(WKNavigationActionPolicyAllow);
            }
            break;
        case CompassURLDestinationExternal:
            [[NSWorkspace sharedWorkspace] openURL:url];
            decisionHandler(WKNavigationActionPolicyCancel);
            break;
        case CompassURLDestinationBlocked:
            self.statusLabel.stringValue = @"安全でないリンクは開けません。";
            self.statusLabel.hidden = NO;
            decisionHandler(WKNavigationActionPolicyCancel);
            break;
    }
}

- (WKWebView *)webView:(WKWebView *)webView
createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration
forNavigationAction:(WKNavigationAction *)navigationAction
windowFeatures:(WKWindowFeatures *)windowFeatures {
    NSURL *url = navigationAction.request.URL;
    CompassURLDestination destination = CompassDestinationForURL(url);

    if (destination == CompassURLDestinationInApp) {
        [webView loadRequest:navigationAction.request];
    } else if (destination == CompassURLDestinationExternal) {
        [[NSWorkspace sharedWorkspace] openURL:url];
    } else {
        self.statusLabel.stringValue = @"安全でないリンクは開けません。";
        self.statusLabel.hidden = NO;
    }

    return nil;
}

@end

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        NSApplication *application = [NSApplication sharedApplication];
        CompassAppDelegate *delegate = [[CompassAppDelegate alloc] init];
        application.delegate = delegate;
        [application run];
    }
    return 0;
}
