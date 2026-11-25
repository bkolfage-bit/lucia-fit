import braintree from "braintree";

let gateway: braintree.BraintreeGateway | null = null;

export function isVenmoEnabled() {
  return Boolean(
    process.env.BRAINTREE_MERCHANT_ID &&
      process.env.BRAINTREE_PUBLIC_KEY &&
      process.env.BRAINTREE_PRIVATE_KEY,
  );
}

export function getBraintree() {
  if (!isVenmoEnabled()) return null;
  if (!gateway) {
    gateway = new braintree.BraintreeGateway({
      environment:
        process.env.BRAINTREE_ENVIRONMENT === "production"
          ? braintree.Environment.Production
          : braintree.Environment.Sandbox,
      merchantId: process.env.BRAINTREE_MERCHANT_ID!,
      publicKey: process.env.BRAINTREE_PUBLIC_KEY!,
      privateKey: process.env.BRAINTREE_PRIVATE_KEY!,
    });
  }
  return gateway;
}

export function getBraintreeMerchantAccountId() {
  return process.env.BRAINTREE_MERCHANT_ACCOUNT_ID || undefined;
}

export function getVenmoProfileId() {
  return process.env.BRAINTREE_VENMO_PROFILE_ID || null;
}
