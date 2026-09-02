FROM alpine:3.20 AS certs
RUN apk --no-cache add ca-certificates

FROM scratch
COPY --from=certs /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY edgemon-agent /usr/local/bin/edgemon-agent

ENTRYPOINT ["/usr/local/bin/edgemon-agent"]
