#!/bin/bash


# make sure to specify the MGMT_API_ACCESS_TOKEN environment variable and CONNECTION_ID environment variable

curl --request PATCH \
  --url "https://naptha.jp.auth0.com/api/v2/connections/$CONNECTION_ID" \
  --header "authorization: Bearer $MGMT_API_ACCESS_TOKEN" \
  --header 'cache-control: no-cache' \
  --header 'content-type: application/json' \
  --data '{ "is_domain_connection": true }'


echo "Finished updating connection."