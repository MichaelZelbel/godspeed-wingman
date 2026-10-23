// The one error a site adapter throws on purpose. `loggedOut` true means the site lost the login:
// the worker stops that site and tells the person once a day, because only they can log in again.
// `refused` true means the Wingman does not work on that site now (its terms were never read, its
// terms forbid automated use and the person has not chosen it, which is `code` "terms", or its
// adapter is broken); the message says why, and how to go on, in plain words. `gone` true (or
// `status` 404) from `profile(id)` means the site has no such profile any more (a deleted account).
export class SiteError extends Error {
  constructor(message, { site = null, loggedOut = false, refused = false, gone = false, code = "", status = 0, details = {} } = {}) {
    super(message);
    this.name = "SiteError";
    this.site = site;
    this.loggedOut = loggedOut;
    this.refused = refused;
    this.gone = gone;
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const isLoggedOut = (e) => !!(e && e.loggedOut === true);
export const isGone = (e) => !!(e && (e.gone === true || e.status === 404));
