"""
Smart Stock Screener.
Combines the existing Insider Conviction Engine with technical, price,
volume, and delivery filters to rank candidate stocks. Reuses the Phase 1
Conviction Engine's data loaders and scoring function directly - this
package computes zero new insider/conviction scoring logic of its own.
"""
