# Admin Runbook

> Sample data: a fictional shop used to demonstrate the Secure Agent Workspace. Internal runbook for the sample orders.

## Who can change orders

Users with the `viewer` role can read orders. Only users with the `admin` role can change an order status or read the audit log. Every tool call, allowed or denied, is written to the audit log.

## Changing an order status

1. Look up the order and check its current status.
2. Check the allowed transitions in the order status guide.
3. Change the status. The change needs a human approval in the workspace before it runs.
4. Confirm the new status by reading the order again.

## Handling a stuck pending order

A pending order older than 48 hours should already be cancelled. If it is still pending, an admin checks the payment provider first. When no payment exists, move the order to `cancelled`. When a payment exists, move it to `paid`.

## Handling a customer who reports a missing parcel

Check that the order is `shipped`. If it shipped more than 10 business days ago, follow the lost parcel rule in the shipping guide and tell the customer a replacement or refund is on the way.

## Reviewing the audit log

Admins can ask for the most recent audit entries. A burst of denied entries for one user usually means that a viewer tried to change an order. Report it to the security contact.
