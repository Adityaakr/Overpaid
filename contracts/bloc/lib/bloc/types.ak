//// Records shared by the campaign policy, the bloc validator and the off-chain
//// mirror in packages/bloc-contract/src/index.ts. Constructor order IS the
//// on-chain Data encoding: do not reorder fields.

use aiken/crypto.{Signature, VerificationKey}
use cardano/address.{Address}
use cardano/assets.{AssetName, PolicyId}

/// The pledged/settlement asset. ADA is `Asset { policy: "", name: "" }`.
pub type Asset {
  policy: PolicyId,
  name: AssetName,
}

/// Inline datum of the campaign UTxO (the one holding the campaign NFT).
/// `bloc_id` is the campaign NFT's asset name. Times are POSIX milliseconds.
pub type CampaignDatum {
  bloc_id: ByteArray,
  item_hash: ByteArray,
  asset: Asset,
  members_limit: Int,
  min_batch: Int,
  bid_deadline: Int,
  refund_deadline: Int,
  provider_vkeys: List<VerificationKey>,
}

/// Inline datum of every pledge UTxO at the bloc script address.
pub type PledgeDatum {
  bloc_id: ByteArray,
  member_refund_address: Address,
  quantity: Int,
  max_unit_price: Int,
}

/// A provider's offer, signed off chain (see message.bid_message).
pub type Bid {
  bloc_id: ByteArray,
  item_hash: ByteArray,
  asset: Asset,
  unit_price: Int,
  expiry: Int,
  provider_vkey: VerificationKey,
  provider_address: Address,
}

/// Redeemer of the `withdraw` (settle) handler.
/// `pairs` = (pledge input index, refund output index), strictly increasing,
/// one per script input, refund output indices >= 1 (output #0 pays the provider).
pub type SettleRedeemer {
  bid: Bid,
  signature: Signature,
  pairs: Pairs<Int, Int>,
}

/// Redeemer of the `spend` handler (per pledge input).
pub type PledgeRedeemer {
  /// Defer to the withdraw-zero settle logic. `input_index` locates this
  /// pledge in tx.inputs, `withdrawal_index` locates our credential in
  /// tx.withdrawals.
  Settle { input_index: Int, withdrawal_index: Int }
  /// Return the whole pledge after the refund deadline to
  /// `member_refund_address`, at `output_index`.
  Refund { input_index: Int, output_index: Int }
}
