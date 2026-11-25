import hashlib
import hmac
import os
from datetime import datetime, timezone, timedelta
import httpx
from fastapi import HTTPException
from sqlalchemy import select
from .models import Subscription, Payment


def plans():
    def amount(name, currency, default):
        return int(os.getenv(f'PRICE_{name.upper()}_{currency}', str(default)))
    return [
        {'id': 'free', 'name': 'Free', 'monthly': {'INR': 0, 'USD': 0}, 'cloudRequestsPerMonth': 0, 'features': ['Local AI', 'Direct BYOK', 'Basic resume analysis', 'Practice and local history']},
        {'id': 'plus', 'name': 'Plus', 'monthly': {'INR': amount('plus', 'INR', 9900), 'USD': amount('plus', 'USD', 199)}, 'cloudRequestsPerMonth': 20, 'features': ['Multiple resume profiles', 'Detailed practice reports', 'Bounded server inference']},
        {'id': 'pro', 'name': 'Pro', 'monthly': {'INR': amount('pro', 'INR', 19900), 'USD': amount('pro', 'USD', 399)}, 'cloudRequestsPerMonth': 50, 'features': ['Multiple resume profiles', 'Full practice analytics', 'Expanded server inference']},
    ]


def active_subscription(db, owner):
    rows = db.scalars(select(Subscription).where(Subscription.owner_id == owner, Subscription.status.in_(['active', 'authenticated', 'pending', 'cancel_at_period_end'])).order_by(Subscription.created_at.desc())).all()
    now = datetime.now(timezone.utc).isoformat()
    # Authenticated is an authorized mandate, not paid access. Only active/trusted paid periods grant access.
    for sub in rows:
        if sub.status in {'active', 'cancel_at_period_end'} and sub.current_end and sub.current_end > now:
            return sub
        if sub.status == 'pending' and sub.current_end:
            # A failed renewal receives a bounded 72-hour grace period after a previously paid cycle.
            grace = datetime.fromisoformat(sub.current_end) + timedelta(hours=72)
            if grace.isoformat() > now: return sub
    return None


class Razorpay:
    def __init__(self, settings, transport=None):
        self.settings = settings
        self.transport = transport

    def configured(self): return bool(self.settings.razorpay_id and self.settings.razorpay_secret)

    async def request(self, method, path, body=None):
        if not self.configured(): raise HTTPException(503, 'Razorpay is not configured; checkout is unavailable')
        async with httpx.AsyncClient(auth=(self.settings.razorpay_id, self.settings.razorpay_secret), transport=self.transport, timeout=20) as client:
            try:
                response = await client.request(method, 'https://api.razorpay.com/v1' + path, json=body)
                response.raise_for_status()
                return response.json()
            except (httpx.HTTPError, ValueError):
                raise HTTPException(502, 'Payment service unavailable or rejected the operation')

    async def checkout(self, db, owner, plan, currency):
        if not self.configured(): raise HTTPException(503, 'Razorpay is not configured; checkout is unavailable')
        plan_id = os.getenv(f'RAZORPAY_PLAN_{plan.upper()}_{currency}', '')
        if not plan_id: raise HTTPException(503, f'Razorpay {plan}/{currency} recurring plan is not configured')
        price = next(p for p in plans() if p['id'] == plan)['monthly'][currency]
        remote_plan = await self.request('GET', '/plans/' + plan_id)
        item = remote_plan.get('item', {})
        if item.get('amount') != price or item.get('currency') != currency or remote_plan.get('period') != 'monthly' or remote_plan.get('interval') != 1:
            raise HTTPException(503, 'Configured Razorpay plan price/period does not match published pricing')
        # Restrict unfinished subscriptions to reduce duplicate checkout creation.
        existing = db.scalar(select(Subscription).where(Subscription.owner_id == owner, Subscription.status.in_(['created', 'authenticated', 'active']), Subscription.plan == plan, Subscription.currency == currency).order_by(Subscription.created_at.desc()))
        if existing:
            return {'subscriptionId': existing.provider_id, 'keyId': self.settings.razorpay_id, 'plan': plan, 'currency': currency, 'amount': price, 'status': existing.status}
        if active_subscription(db, owner):
            raise HTTPException(409, 'Use /billing/change-plan to schedule a change to an active subscription')
        remote = await self.request('POST', '/subscriptions', {'plan_id': plan_id, 'total_count': 120, 'quantity': 1, 'customer_notify': 1})
        sub = Subscription(owner_id=owner, provider_id=remote['id'], plan=plan, currency=currency, amount=price, status=remote.get('status', 'created'))
        db.add(sub)
        db.commit()
        return {'subscriptionId': sub.provider_id, 'keyId': self.settings.razorpay_id, 'plan': plan, 'currency': currency, 'amount': price, 'status': sub.status}

    async def change_plan(self, db, owner, plan, currency):
        sub = active_subscription(db, owner)
        if not sub or sub.status != 'active': raise HTTPException(409, 'An active subscription is required to schedule a plan change')
        if currency != sub.currency: raise HTTPException(422, 'Currency cannot change within a subscription; cancel at period end and start a new subscription')
        if plan == sub.plan: raise HTTPException(409, 'This plan is already active')
        plan_id = os.getenv(f'RAZORPAY_PLAN_{plan.upper()}_{currency}', '')
        if not plan_id: raise HTTPException(503, 'Requested Razorpay plan is not configured')
        amount = next(p for p in plans() if p['id'] == plan)['monthly'][currency]
        remote_plan = await self.request('GET', '/plans/' + plan_id)
        item = remote_plan.get('item', {})
        if item.get('amount') != amount or item.get('currency') != currency or remote_plan.get('period') != 'monthly' or remote_plan.get('interval') != 1:
            raise HTTPException(503, 'Configured Razorpay plan price/period does not match published pricing')
        await self.request('PATCH', '/subscriptions/' + sub.provider_id, {'plan_id': plan_id, 'schedule_change_at': 'cycle_end', 'customer_notify': 1})
        sub.pending_plan, sub.pending_amount = plan, amount
        db.commit()
        return {'scheduled': True, 'plan': sub.plan, 'pendingPlan': plan, 'effectiveAt': sub.current_end}

    def signature(self, message, signature, secret):
        if not secret: raise HTTPException(503, 'Payment verification secret is not configured')
        expected = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature): raise HTTPException(400, 'Invalid payment signature')

    async def verify(self, db, owner, data):
        sub = db.scalar(select(Subscription).where(Subscription.provider_id == data.razorpay_subscription_id, Subscription.owner_id == owner))
        if not sub: raise HTTPException(404, 'Subscription not found')
        self.signature((data.razorpay_payment_id + '|' + sub.provider_id).encode(), data.razorpay_signature, self.settings.razorpay_secret)
        remote = await self.request('GET', '/subscriptions/' + sub.provider_id)
        payment = await self.request('GET', '/payments/' + data.razorpay_payment_id)
        # A valid signature alone is insufficient; verify captured funds and recurring membership.
        if payment.get('status') != 'captured' or payment.get('amount') != sub.amount or payment.get('currency') != sub.currency or remote.get('status') != 'active' or not remote.get('current_end'):
            raise HTTPException(409, 'Payment has not been captured for the expected active plan')
        if payment.get('invoice_id'):
            invoice = await self.request('GET', '/invoices/' + payment['invoice_id'])
            if invoice.get('subscription_id') != sub.provider_id or invoice.get('payment_id') != payment['id']:
                raise HTTPException(400, 'Payment invoice does not belong to this subscription')
        else:
            raise HTTPException(409, 'Subscription payment invoice is required for verification')
        sub.status = 'active'
        sub.current_end = datetime.fromtimestamp(remote['current_end'], timezone.utc).isoformat()
        self.record_payment(db, sub, payment)
        db.commit()
        return {'verified': True, 'plan': sub.plan, 'status': sub.status, 'currentEnd': sub.current_end}

    def record_payment(self, db, sub, payment):
        existing = db.scalar(select(Payment).where(Payment.provider_id == payment['id']))
        if not existing:
            existing = Payment(owner_id=sub.owner_id, provider_id=payment['id'], subscription_id=sub.id, amount=payment.get('amount', 0), currency=payment.get('currency', sub.currency), status=payment.get('status', 'unknown'), invoice_id=payment.get('invoice_id'))
            db.add(existing)
        else:
            existing.status = payment.get('status', existing.status)
        return existing
