//// Fixed-layout bid message signed by providers with ed25519.
//// Layout (documented in README.md, mirrored by bidMessage() in TS):
////
////   "BLOCBID1"                (8 bytes, ASCII)
////   campaign_policy           (28 bytes)
////   lp(bloc_id)               (u8 length ‖ bytes)
////   lp(item_hash)
////   lp(asset.policy)          (0 or 28 bytes)
////   lp(asset.name)            (0..32 bytes)
////   u64be(unit_price)
////   u64be(expiry)             (POSIX ms)
////   provider_vkey             (32 bytes)
////   address(provider_address) (payment tag ‖ 28, stake tag [‖ 28])
////
//// payment tag: 0x00 = verification key, 0x01 = script
//// stake tag:   0x00 = none, 0x01 = inline key, 0x02 = inline script
//// Pointer stake credentials are not supported (fail).

use aiken/crypto.{Signature, verify_ed25519_signature}
use aiken/primitive/bytearray
use bloc/types.{Bid}
use cardano/address.{Address, Inline, Pointer, Script, VerificationKey}
use cardano/assets.{PolicyId}

pub const magic: ByteArray = "BLOCBID1"

fn lp(bytes: ByteArray) -> ByteArray {
  bytearray.concat(
    bytearray.from_int_big_endian(bytearray.length(bytes), 1),
    bytes,
  )
}

fn u64(n: Int) -> ByteArray {
  bytearray.from_int_big_endian(n, 8)
}

fn hash28(tag: ByteArray, h: ByteArray) -> ByteArray {
  expect bytearray.length(h) == 28
  bytearray.concat(tag, h)
}

pub fn address_bytes(addr: Address) -> ByteArray {
  let payment = when addr.payment_credential is {
    VerificationKey(h) -> hash28(#"00", h)
    Script(h) -> hash28(#"01", h)
  }
  let stake = when addr.stake_credential is {
    None -> #"00"
    Some(Inline(VerificationKey(h))) -> hash28(#"01", h)
    Some(Inline(Script(h))) -> hash28(#"02", h)
    Some(Pointer { .. }) -> fail @"pointer stake credentials unsupported"
  }
  bytearray.concat(payment, stake)
}

pub fn bid_message(campaign_policy: PolicyId, bid: Bid) -> ByteArray {
  expect bytearray.length(campaign_policy) == 28
  magic
    |> bytearray.concat(campaign_policy)
    |> bytearray.concat(lp(bid.bloc_id))
    |> bytearray.concat(lp(bid.item_hash))
    |> bytearray.concat(lp(bid.asset.policy))
    |> bytearray.concat(lp(bid.asset.name))
    |> bytearray.concat(u64(bid.unit_price))
    |> bytearray.concat(u64(bid.expiry))
    |> bytearray.concat(bid.provider_vkey)
    |> bytearray.concat(address_bytes(bid.provider_address))
}

/// Length checks first: the builtin halts (instead of returning False) on a
/// key that is not 32 bytes or a signature that is not 64 bytes.
pub fn verify_bid(
  campaign_policy: PolicyId,
  bid: Bid,
  signature: Signature,
) -> Bool {
  let vk = bid.provider_vkey
  and {
    bytearray.length(vk) == 32,
    bytearray.length(signature) == 64,
    verify_ed25519_signature(vk, bid_message(campaign_policy, bid), signature),
  }
}
