# ============ STAGE 1: Build Rust backend ============
FROM rust:1.88-slim AS rust-builder
WORKDIR /app
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release
RUN rm -rf src
COPY src ./src
RUN touch src/main.rs && cargo build --release
# ============ STAGE 2: Build Node bridge ============
FROM node:20-bookworm-slim AS node-builder
WORKDIR /bridge
COPY K45movies-api/package.json K45movies-api/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY K45movies-api/ ./
RUN npm run build
# ============ STAGE 3: Runtime ============
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y \
    ca-certificates \
    python3 \
    ffmpeg \
    curl \
    supervisor \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*
# Install Node.js runtime binary and its libs
COPY --from=node-builder /usr/local/bin/node /usr/local/bin/node
COPY --from=node-builder /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
# Copy Rust binary
COPY --from=rust-builder /app/target/release/mbox /usr/local/bin/mbox
# Copy Node bridge (with node_modules + dist built)
COPY --from=node-builder /bridge /app/K45movies-api
# Copy supervisord config
COPY supervisord.conf /etc/supervisor/conf.d/app.conf
ENV PORT=8080
EXPOSE 8080
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
