FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

COPY station-agent.sln ./
COPY shared/ shared/
COPY services/job-engine/ services/job-engine/

RUN dotnet restore services/job-engine/src/ND.JobEngine.Api/ND.JobEngine.Api.csproj

RUN dotnet publish services/job-engine/src/ND.JobEngine.Api/ND.JobEngine.Api.csproj \
    -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app

RUN adduser --disabled-password --gecos '' appuser && chown -R appuser /app
USER appuser

COPY --from=build /app/publish .

VOLUME ["/data", "/logs"]

EXPOSE 5002
ENV DOTNET_ENVIRONMENT=Production
ENV ASPNETCORE_URLS=http://+:5002

ENTRYPOINT ["dotnet", "ND.JobEngine.Api.dll"]
