FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

# Copy solution and project files for restore
COPY station-agent.sln ./
COPY shared/ shared/
COPY services/mqtt-adapter/ services/mqtt-adapter/

RUN dotnet restore services/mqtt-adapter/src/ND.MqttAdapter.Worker/ND.MqttAdapter.Worker.csproj

RUN dotnet publish services/mqtt-adapter/src/ND.MqttAdapter.Worker/ND.MqttAdapter.Worker.csproj \
    -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app

RUN adduser --disabled-password --gecos '' appuser && chown -R appuser /app
USER appuser

COPY --from=build /app/publish .

VOLUME ["/data", "/logs"]

ENV DOTNET_ENVIRONMENT=Production

ENTRYPOINT ["dotnet", "ND.MqttAdapter.Worker.dll"]
