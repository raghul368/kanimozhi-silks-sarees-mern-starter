# Kanimozhi Silks Sarees — MERN starter

A luxury silk-saree e-commerce starter with a React/Vite storefront and an Express/MongoDB API.

## Requirements
- Node.js 20+
- MongoDB local instance or MongoDB Atlas connection string

## Run the backend
```bash
cd backend
cp .env.example .env
npm install
npm run dev
```
The API runs at `http://localhost:5000`. The public catalogue is read from active MongoDB products; it stays empty when the database is unavailable rather than showing demo products that are not in the admin inventory.

To add the 20 sample silk sarees to the admin inventory, run `npm run seed` from `backend`. It inserts missing sample IDs, refreshes photo-based names/colors/descriptions for the seeded products and two configured catalogue IDs, and migrates only known legacy starter image URLs. It leaves product prices and categories unchanged; custom images are otherwise kept. Sample prices range from ₹15,000 to ₹35,000; admins can edit each product's name, price, and image URL.

The sample sarees use distinct Wikimedia Commons or configured Google Drive images. Product cards display image creator and license links when available; changing an image in admin clears the old image credit. Google Drive-backed images are served through the API image proxy.

## Configure private admin access
Set these values in `backend/.env` before signing in. Admin sign-in is a separate flow at `http://localhost:5173/admin`; customer sign-in remains available from the storefront and does not provide admin access.
```env
ADMIN_USERNAME=your-private-username
ADMIN_PASSWORD=use-a-unique-strong-password
ADMIN_SESSION_SECRET=use-a-random-secret-at-least-32-characters-long
```
Keep these credentials and the session secret private; do not commit `.env` or share them with the storefront URL. Admin sign-in is required before product changes are accepted by the API. The admin inventory can add, edit, or remove products from the public catalogue; removal deactivates the product while preserving existing order records. The signed admin session stays in page memory, expires after eight hours, and is not included when you share the URL. Without valid admin configuration, product changes remain disabled.

## Customer accounts
The storefront **Sign in** page supports customer registration and sign-in using a username or email and password. Customer accounts are stored in MongoDB, and passwords are salted and hashed. Set a random secret of at least 32 characters in `backend/.env`; customer sessions use an HttpOnly cookie:
```env
CUSTOMER_SESSION_SECRET=your-random-secret-at-least-32-characters
```

Customer access uses username/email and password. Customers may browse the public catalogue without signing in; a customer account is required to place an order. Google sign-in is optional; when configured, its button appears on the customer sign-in page. Create a Google OAuth **Web application** client ID, add the storefront origin (for local development, `http://localhost:5173`) to its authorized JavaScript origins, then set the client ID in `backend/.env` and restart the backend:
```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```
Customer registration and sign-in require MongoDB to be connected. Store admin sign-in is separate and available at `/admin`.

If account creation reports that MongoDB cannot be reached, add your current IP address under the Atlas project's **Network Access**, then restart the backend and verify `http://localhost:5000/api/health` reports `"database":"connected"`. The health endpoint switches to `"demo-mode"` after the backend detects a lost database connection.

## Configure payments and orders
Checkout is available to signed-in customer accounts. The backend builds each order total from the current MongoDB product prices, creates Razorpay orders, verifies the payment signature and captured amount, and records the resulting order under that customer. Cash on Delivery orders are also saved. Customers can review their order history and cancel pending Cash on Delivery orders that are still placed or processing from **My account**. Contact the store to request cancellation or a refund for online-payment orders. Admins can review orders, update fulfilment status, and add carrier/tracking information from the **Orders** dashboard section. Customers see tracking details in order history.

Create a Razorpay account and add its credentials to `backend/.env`; never put the secret or webhook secret in frontend code or share them publicly:
```env
RAZORPAY_KEY_ID=rzp_test_your_key_id
RAZORPAY_KEY_SECRET=your_private_key_secret
RAZORPAY_WEBHOOK_SECRET=your_private_webhook_secret
```
Use Razorpay test credentials while testing and live credentials only after activating the merchant account. Configure the payment methods you want enabled (UPI, cards, net banking, and wallets) in Razorpay Checkout. In the Razorpay dashboard, add a webhook pointing to `https://your-api-domain/api/payments/razorpay/webhook` and subscribe to `payment.captured` and `order.paid`. Set its signing secret as `RAZORPAY_WEBHOOK_SECRET`. Restart the backend after setting credentials. MongoDB must be connected for online or COD orders.

## Run the frontend
In another terminal:
```bash
cd frontend
npm install
npm run dev
```
Open the Vite URL shown in the terminal.

For a deployed storefront and API on different domains, set `VITE_API_URL` to the backend origin (without `/api`) in the frontend hosting environment before building. For example:
```env
VITE_API_URL=https://your-api-domain
```
The frontend appends `/api` to this origin. If both are served on the same origin through a reverse proxy, `VITE_API_URL` can be omitted. Set `CLIENT_URL` in the backend hosting environment to the exact deployed storefront origin (without a trailing slash) so the API accepts credentialed customer requests. Production backend startup requires `CLIENT_URL`; the local development defaults are not used in production.

## Email notifications
The app stores newsletter subscriptions in MongoDB. Configure Resend to send welcome messages, order confirmations, and fulfilment updates:
```env
RESEND_API_KEY=your-private-resend-api-key
EMAIL_FROM=Kanimozhi Silks <verified-sender@your-domain>
```
Verify the sender domain/address with Resend. Keep the API key only in `backend/.env`; never add it to frontend configuration. Orders and subscriptions are still saved if email delivery is unavailable. The checkout reports when a confirmation email could not be sent, and the admin dashboard reports notification failures after fulfilment updates.

## Included
- Luxury responsive storefront
- Product search and category filtering
- AI virtual saree try-on with person and saree image uploads (requires Cloudflare Workers AI credentials)
- Product cards and quick add-to-cart
- Cart drawer with quantity controls and local-device persistence
- Persistent wishlist with a usable saved-items drawer
- Product details with descriptions
- MongoDB-backed newsletter signups and admin subscriber list
- Express product API with optional MongoDB persistence
- Product model and seed data
- Role-separated owner and customer sign-in
- Owner-only product creation and editing
- Customer catalogue refreshes automatically after product changes
- Customer profile, logout, and order history
- Server-priced checkout with Razorpay payment verification and Cash on Delivery

## Configure AI saree try-on
Create a Cloudflare API token with Workers AI access and copy your Cloudflare Account ID into `backend/.env`, then restart the backend:
```env
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_API_TOKEN=your-secret-api-token
```
For a $0 setup, use Cloudflare's Workers Free plan and stay within its 10,000-Neuron daily allocation. Workers Paid accounts can be charged for usage above that allowance. The storefront's **AI Try-On** tab accepts a full-length person photo and a saree image (JPG, PNG, or WebP; up to 3 MB each). After the user consents, all three images are stored in the separate `virtualtryonhistories` MongoDB collection for up to 30 days. The entry expires automatically and can also be deleted sooner from the admin dashboard. Only signed-in admins can view the saved history. MongoDB must be connected (the `/api/health` endpoint should report `"database":"connected"`) for try-on generation and history storage. The images are sent from the backend to Cloudflare Workers AI using the `@cf/black-forest-labs/flux-2-klein-4b` model; keep the API token on the backend. Requests can fail after the free daily allocation or a rate limit is reached. See [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/). The feature makes a generated visualization, not an exact fit or color guarantee.

## Before going live
Verify product photography, prices and descriptions, configure MongoDB Atlas and Razorpay live credentials, verify the Resend sender, confirm tax/shipping requirements, and deploy using HTTPS. Online and Cash on Delivery checkout are implemented; MongoDB must be connected to place orders. Make sure the storefront privacy and no-returns information matches your business practices.

## Selected business settings
- India-only delivery form (Indian mobile and PIN-code validation).
- Online payment is processed through Razorpay Checkout (available methods depend on the merchant account); Cash on Delivery is also available.
- The admin dashboard and customer account/order history use separate signed sessions.
- Customer checkout and order persistence require a connected MongoDB database.
- Shipping/delivery: within 3 days; returns are not accepted.
- Email: `kanimozhisilkss@gmail.com`
- Phone/WhatsApp: `+91 99651 80542`
- Address: 83, North Mada Street, Nedungunam Village & Post, Chetpet Taluk, Thiruvannamalai, Tamil Nadu, 606807.
- Instagram: [@kanimozhisilks_arulprakasam](https://www.instagram.com/kanimozhisilks_arulprakasam?dlrf=OTNyZ3Fkd2QwMDVz)
