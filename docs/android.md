# The Android emulator (experimental)

Some dating services have no website, only a phone app. For those, the Wingman can run an Android
emulator on your computer: a virtual phone in a window. You install the app there and log in, and
an Android site adapter works the app the way a finger does: it reads the screen, taps, scrolls and
types.

This is experimental. A website is always simpler and steadier, so the Wingman uses this only for
a service that has no website. And the terms work as for any site: many app makers forbid
automated use; your mission control tells you what an app's terms say, and you decide (see
[adding-a-site.md](adding-a-site.md)).

## What it needs

- A 64-bit computer with Windows 10 or 11, macOS, or Linux.
- Hardware virtualisation:
  - Windows: the **Windows Hypervisor Platform**, a part of Windows that is often switched off.
    Switch it on in "Turn Windows features on or off", or in a PowerShell opened as administrator:
    `Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform`, then restart.
    Virtualisation (Intel VT-x or AMD-V) must also be on in the computer's firmware settings; on
    most computers it is.
  - macOS: built in.
  - Linux: KVM (on Ubuntu or Debian: `sudo apt install qemu-kvm`, then
    `sudo adduser $USER kvm` and log out and in). Rented servers often do not offer it.
- About 15 GB of free disk space, most of it the Android system the emulator runs.
- 8 GB of memory at least; 16 GB is more comfortable.
- Java 17 or newer. When it is missing, the Wingman offers to fetch Eclipse Temurin JDK 17 from
  adoptium.net, and does so only after you say yes.
- A Google account for the Play Store in the emulator, and your account for the dating app.

## Setting it up

First a dry run. It looks at your computer, reads Google's lists of Android tools, and checks that
every download answers, without downloading anything big or changing anything:

```
godspeed-wingman android setup --dry-run
```

It tells you whether an Android SDK is already there (from Android Studio, for example), whether
Java is there, which versions it would fetch (always the newest stable ones Google lists that day),
how much room there is, and whether hardware acceleration is switched on.

Then the setup itself:

```
godspeed-wingman android setup
```

1. **The licence.** The Android tools come with Google's Android SDK licence. The setup shows it
   and asks whether you accept it. Nobody else can say yes for you. (If your mission control runs
   the setup for you, it asks you first and then adds `--accept-licenses`.)
2. **Java,** when missing, after your yes (or `--yes`).
3. **The downloads:** the Android command-line tools, then platform-tools (adb), the emulator and
   a Google Play system image. Every download is checked against the checksum Google or Adoptium
   publishes. This is the long part.
4. **The virtual phone,** called "wingman": a Pixel phone with Google Play.
5. **The acceleration check.** If the emulator cannot use hardware acceleration, the setup stops
   here and says what to switch on. Everything is installed by then; start it later with
   `godspeed-wingman android start`.
6. **The first start.** The emulator's window opens.

Then it is your turn, because it needs your accounts:

1. In the emulator's window, open the Play Store and sign in with a Google account.
2. Install the dating app, open it and log in.
3. Tell your mission control that the app is installed and you are logged in, or run
   `godspeed-wingman android status`.

## Every day

```
godspeed-wingman android status     the SDK, the virtual phone, whether it runs, whether the apps are installed
godspeed-wingman android start      start the emulator (--headless: without a window)
godspeed-wingman android stop       stop it
```

The emulator must run at session time, like the Wingman's browser for a website. After you have
logged in, `--headless` runs it without a window.

## Building an Android site

```
godspeed-wingman site new <id> --kind android --name "<Name>" --package com.example.app
godspeed-wingman android dump         what is on the screen: text, description, id, where
godspeed-wingman android screenshot   a picture of the screen
godspeed-wingman site check <id>      reading only
```

The package name is the id in the app's Play Store address (`?id=com.example.app`). The template
in the new folder shows how an adapter reads the card in front, opens a profile and scrolls
through it, likes or passes with one tap, and reads and sends messages. Before a like or a pass it
reads the card again, so it never taps for the wrong person.

During `site check`, the emulator is guarded: no taps on anything labelled like, pass, send and the
like, no typing, no sideways swipes. Opening, scrolling and Back work.

## Honest limits

- Some apps refuse to run in an emulator, or notice it and lock the account. When that happens,
  stop: the Wingman will not work around it.
- App updates change the screens; the adapter then needs a repair, and `site check` says so.
- adb types only plain letters, digits and punctuation. A reply with an emoji, an accent or a line
  break is refused instead of being sent garbled; you send that one yourself.
- An app is slower to read than a website, and an app shows no profile address, so the Wingman's
  messages about an app profile have no link.
- One emulator serves every Android site. The settings can name another device
  (`android_device`, for example `emulator-5556`); a phone on USB is used only when named there.

## Where it lives, and removing it

Everything the Wingman installs for Android is in one folder, `~/.godspeed/android`
(`%USERPROFILE%\.godspeed\android` on Windows):

- `sdk/`: the Android tools (only when no SDK was there before),
- `jdk/`: the Java it fetched, if it did,
- `avd/`: the virtual phone, with the apps and logins in it,
- `android.json`: what the setup chose; `emulator.log`: the emulator's log.

To take it out:

```
godspeed-wingman android remove
```

It stops the emulator and, after you say yes, deletes that folder, with the apps and logins in the
virtual phone. An Android SDK that was there before the Wingman (Android Studio's) stays where it
is. Switch the Android sites off too: `godspeed-wingman site off <id>`. If you switched on the
Windows Hypervisor Platform only for this, you can switch it off again the same way.
