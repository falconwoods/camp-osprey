CREATE INDEX "booking_results_trip_idx" ON "booking_results" USING btree ("tripId");--> statement-breakpoint
CREATE INDEX "booking_results_user_idx" ON "booking_results" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "trips_user_idx" ON "trips" USING btree ("userId");