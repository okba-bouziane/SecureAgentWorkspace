# Order Statuses

> Sample data: a fictional shop used to demonstrate the Secure Agent Workspace. Matches the sample orders served by SecureMCP.

An order always has exactly one of five statuses.

## pending

The order was placed but payment has not been confirmed. Pending orders are held for 48 hours. If payment does not arrive in that time the order is moved to `cancelled`.

## paid

Payment is confirmed and the order waits for the warehouse. Most orders stay `paid` for less than one business day.

## shipped

The parcel left the warehouse and has a tracking number. Customers cannot change the delivery address any more.

## delivered

The carrier confirmed delivery. The return window of 30 days starts on this day.

## cancelled

The order was cancelled by the customer, by support or automatically. Cancelled orders are never shipped. A cancelled order must not be moved back to another status; create a new order instead.

## Allowed transitions

`pending` to `paid` or `cancelled`. `paid` to `shipped` or `cancelled`. `shipped` to `delivered`. `delivered` and `cancelled` are final.
