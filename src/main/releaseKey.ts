import config from '../../config/release-key.json'
import { publicKeyFrom } from './signature'

/** Mordsome's release key, built into the launcher. Null if this build has none. */
export const RELEASE_KEY = publicKeyFrom(typeof config.publicKey === 'string' ? config.publicKey : '')

/** When on, Kairo releases without a valid SHA256SUMS.txt.sig are never installed. */
export const REQUIRE_KAIRO_SIGNATURE = config.requireKairoSignature === true
