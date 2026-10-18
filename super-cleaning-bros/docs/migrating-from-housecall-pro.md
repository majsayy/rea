# Moving off Housecall Pro

Housecall Pro stays the system of record until a week of real jobs has been booked, completed, invoiced, and paid in Super Cleaning Bros. This app does not connect to Housecall Pro and does not read its database.

## Export what you can

In Housecall Pro, export the customer list and a job or invoice report as CSV. The column names vary by account and version. If a report is missing addresses, prices, or statuses, ask Housecall Pro support for an account data export before the subscription ends.

Cards on file cannot be exported. Processors do not hand over full card numbers. After cutover, each customer needs a new card saved through Stripe. Download before-and-after photos you still need while the Housecall Pro account is open; this importer does not fetch them.

## Map the CSV

The importer accepts a header row. Names are not case sensitive. Common Housecall Pro headers are listed on the right.

| This app | Also accepted |
| --- | --- |
| First Name | first_name |
| Last Name | last_name |
| Mobile Number | phone, phone_number, home_number |
| Email | email |
| Address | address_line1, street |
| City | city |
| State | state |
| Zip | postal_code, zip_code |
| Job Title | title, description |
| Job Date | scheduled_start, scheduled_date |
| Scheduled End | scheduled_end, end |
| Total | service_dollars, amount, job_total |
| Status | status |

Example:

```csv
First Name,Last Name,Mobile Number,Email,Address,City,State,Zip,Job Title,Job Date,Total,Status
Ada,Lovelace,(303) 555-0111,ada@example.com,10 Main St,Erie,CO,80516,Standard clean,2026-10-22,180.00,Completed
```

A date by itself is 9:00 America/Denver. `Completed` becomes done. `Cancelled` is skipped. The dollar total is the accepted price, so a distance fee is not added on top. If the road distance from Erie is already more than 35 miles and the total is large enough, that fee is kept inside the total for the shop books. It is not written as its own line.

Customers match on last name plus phone or last name plus address. Importing twice does not create a second Garcia with the same phone.

Paste the file on the Import screen, or:

```bash
curl -s -X POST http://localhost:8787/api/import/customers \
  -H 'content-type: application/json' \
  --cookie 'scb_session=...' \
  -d '{"csv":"First Name,Last Name,Mobile Number,Address,City,State,Zip\nAda,Lovelace,3035550111,10 Main St,Erie,CO,80516"}'
```

## Cutover

1. Create crew members and PINs. Set `OFFICE_PASSWORD` before the site is reachable.
2. Import customers and open jobs. Leave completed history imported only if you want it in reports.
3. Connect GoHighLevel and book one test appointment. Confirm the customer and job appear once.
4. Run one real job through start, photos or walkthrough, invoice, and charge.
5. Keep Housecall Pro read-only for a week. Compare the week's jobs and payments.
6. Cancel Housecall Pro after that week matches and the photo archive has been saved.
