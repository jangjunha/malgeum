FROM rust:1.94-slim AS build
WORKDIR /src
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
COPY --from=build /src/target/release/malguem-server /usr/local/bin/malguem-server
ENV MALGUEM_DB=/data/malguem.sqlite3 MALGUEM_BIND=0.0.0.0:8787
VOLUME /data
EXPOSE 8787
CMD ["malguem-server"]
