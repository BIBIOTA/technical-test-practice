from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    interview_token: str
    database_url: str
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    gemini_api_key: str = ""
    default_eval_provider: str = "openai"
    evaluation_offline_mode: bool = False


settings = Settings()
