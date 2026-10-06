#!/usr/bin/env bash
# Registers the Pi's IoT certificate from a CSR generated on the Pi by pi/install.sh.
# The private key stays on the Pi; only the CSR (public) comes here and the cert (public) goes back.
#
# Usage: ./scripts/register-device-cert.sh nellie-cam.csr
# Run with admin AWS credentials, in the same region as the deployed NellieCamStack.
set -euo pipefail

THING_NAME=nellie-cam
POLICY_NAME=nellie-cam-device
CSR_FILE="${1:?Usage: $0 <path-to-csr>}"
CERT_FILE="${THING_NAME}.cert.pem"

if [[ -e "$CERT_FILE" ]]; then
  echo "$CERT_FILE already exists; remove it first if you want to register a new certificate." >&2
  exit 1
fi

cert_id=$(aws iot create-certificate-from-csr \
  --certificate-signing-request "file://$CSR_FILE" \
  --set-as-active \
  --query certificateId --output text)

cert_arn=$(aws iot describe-certificate --certificate-id "$cert_id" \
  --query certificateDescription.certificateArn --output text)
aws iot describe-certificate --certificate-id "$cert_id" \
  --query certificateDescription.certificatePem --output text > "$CERT_FILE"

aws iot attach-policy --policy-name "$POLICY_NAME" --target "$cert_arn"
aws iot attach-thing-principal --thing-name "$THING_NAME" --principal "$cert_arn"

endpoint=$(aws iot describe-endpoint --endpoint-type iot:Data-ATS --query endpointAddress --output text)
credentials_endpoint=$(aws iot describe-endpoint --endpoint-type iot:CredentialProvider --query endpointAddress --output text)

echo
echo "Registered certificate $cert_id and attached it to $THING_NAME."
echo "Copy $CERT_FILE to the Pi at /etc/nellie-cam/iot/device.cert.pem and set in /etc/nellie-cam/nellie-cam.env:"
echo "  IOT_ENDPOINT=$endpoint"
echo "  IOT_CREDENTIALS_ENDPOINT=$credentials_endpoint"
