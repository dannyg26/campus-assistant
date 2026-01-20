# app/routers/users.py
from __future__ import annotations

from typing import Literal, Optional, cast

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select, update

from app.db import get_conn, refresh_tokens, users, utcnow_iso
from app.deps import CurrentUser, get_current_user, require_admin

router = APIRouter(prefix="/users", tags=["users"])


class UserInfo(BaseModel):
    id: str
    email: str
    name: str
    role: Literal["admin", "student"]
    profile_pic: Optional[str] = None
    is_active: bool
    deleted_at: Optional[str]
    created_at: str


class UserListResponse(BaseModel):
    users: list[UserInfo]
    total: int


class DeleteStudentResponse(BaseModel):
    success: bool
    message: str
    student_email: str


class UpdateProfileRequest(BaseModel):
    name: Optional[str] = None
    profile_pic: Optional[str] = None


class UpdateProfileResponse(BaseModel):
    success: bool
    message: str


@router.get("", response_model=UserListResponse)
def list_users(
    include_deleted: bool = Query(False, description="Include soft-deleted users"),
    role: Optional[Literal["admin", "student"]] = Query(None, description="Filter by role"),
    admin: CurrentUser = Depends(require_admin),
) -> UserListResponse:
    with get_conn() as conn:
        query = select(
            users.c.id,
            users.c.email,
            users.c.name,
            users.c.role,
            users.c.profile_pic,
            users.c.is_active,
            users.c.deleted_at,
            users.c.created_at,
        ).where(users.c.org_id == admin.org_id)

        if not include_deleted:
            query = query.where(users.c.deleted_at.is_(None))

        if role:
            query = query.where(users.c.role == role)

        query = query.order_by(users.c.created_at.desc())
        rows = conn.execute(query).mappings().all()

        user_list = [
            UserInfo(
                id=str(row["id"]),
                email=str(row["email"]),
                name=str(row["name"]),
                role=cast(Literal["admin", "student"], row["role"]),
                profile_pic=str(row["profile_pic"]) if row["profile_pic"] else None,
                is_active=bool(row["is_active"]),
                deleted_at=str(row["deleted_at"]) if row["deleted_at"] else None,
                created_at=str(row["created_at"]),
            )
            for row in rows
        ]

    return UserListResponse(users=user_list, total=len(user_list))


@router.delete("", response_model=DeleteStudentResponse, status_code=status.HTTP_200_OK)
def delete_student(
    email: EmailStr = Query(..., description="Email address of the student to delete"),
    admin: CurrentUser = Depends(require_admin),
) -> DeleteStudentResponse:
    email_normalized = email.strip().lower()

    with get_conn() as conn, conn.begin():
        student_row = conn.execute(
            select(
                users.c.id,
                users.c.org_id,
                users.c.role,
                users.c.email,
                users.c.deleted_at,
            ).where(
                users.c.org_id == admin.org_id,
                users.c.email == email_normalized,
            )
        ).mappings().first()

        if not student_row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found in your organization")

        if str(student_row["role"]) != "student":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Can only delete students.")

        if student_row["deleted_at"] is not None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Student has already been deleted")

        deleted_timestamp = utcnow_iso()

        result = conn.execute(
            update(users)
            .where(users.c.id == student_row["id"])
            .values(
                deleted_at=deleted_timestamp,
                is_active=False,
            )
        )

        if result.rowcount == 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to delete student.")

        # Revoke all refresh tokens for this user (defense-in-depth)
        conn.execute(
            update(refresh_tokens)
            .where(
                refresh_tokens.c.user_id == student_row["id"],
                refresh_tokens.c.revoked_at.is_(None),
            )
            .values(revoked_at=utcnow_iso())
        )

    return DeleteStudentResponse(
        success=True,
        message=f"Student {email_normalized} has been removed successfully",
        student_email=email_normalized,
    )


class CurrentUserProfileResponse(BaseModel):
    id: str
    email: str
    name: str
    role: Literal["admin", "student"]
    profile_pic: Optional[str] = None


@router.get("/me", response_model=CurrentUserProfileResponse)
def get_my_profile(
    user: CurrentUser = Depends(get_current_user),
) -> CurrentUserProfileResponse:
    """Get the current user's profile information."""
    return CurrentUserProfileResponse(
        id=user.user_id,
        email=user.email,
        name=user.name,
        role=user.role,
        profile_pic=user.profile_pic,
    )


@router.put("/me", response_model=UpdateProfileResponse)
def update_my_profile(
    req: UpdateProfileRequest,
    user: CurrentUser = Depends(get_current_user),
) -> UpdateProfileResponse:
    """Update the current user's profile (name and/or profile_pic)."""
    with get_conn() as conn, conn.begin():
        update_values = {}
        
        if req.name is not None:
            update_values["name"] = req.name.strip()
        
        if req.profile_pic is not None:
            update_values["profile_pic"] = req.profile_pic.strip() if req.profile_pic.strip() else None
        
        if not update_values:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No fields to update"
            )
        
        conn.execute(
            update(users)
            .where(users.c.id == user.user_id)
            .values(**update_values)
        )
    
    return UpdateProfileResponse(
        success=True,
        message="Profile updated successfully"
    )


@router.put("/{user_id}/name", response_model=UpdateProfileResponse)
def update_user_name(
    user_id: str,
    req: UpdateProfileRequest,
    admin: CurrentUser = Depends(require_admin),
) -> UpdateProfileResponse:
    """Admin-only endpoint to update a user's name."""
    if not req.name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Name is required"
        )
    
    with get_conn() as conn, conn.begin():
        # Verify user exists and belongs to same org
        user_row = conn.execute(
            select(users.c.id, users.c.org_id)
            .where(users.c.id == user_id)
        ).mappings().first()
        
        if not user_row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )
        
        if str(user_row["org_id"]) != admin.org_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot update user from another organization"
            )
        
        conn.execute(
            update(users)
            .where(users.c.id == user_id)
            .values(name=req.name.strip())
        )
    
    return UpdateProfileResponse(
        success=True,
        message="User name updated successfully"
    )


@router.put("/{user_id}/profile", response_model=UpdateProfileResponse)
def update_user_profile(
    user_id: str,
    req: UpdateProfileRequest,
    admin: CurrentUser = Depends(require_admin),
) -> UpdateProfileResponse:
    """Admin-only endpoint to update a user's profile (name and/or profile_pic)."""
    with get_conn() as conn, conn.begin():
        # Verify user exists and belongs to same org
        user_row = conn.execute(
            select(users.c.id, users.c.org_id)
            .where(users.c.id == user_id)
        ).mappings().first()
        
        if not user_row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )
        
        if str(user_row["org_id"]) != admin.org_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot update user from another organization"
            )
        
        update_values = {}
        
        if req.name is not None:
            update_values["name"] = req.name.strip()
        
        if req.profile_pic is not None:
            update_values["profile_pic"] = req.profile_pic.strip() if req.profile_pic.strip() else None
        
        if not update_values:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No fields to update"
            )
        
        conn.execute(
            update(users)
            .where(users.c.id == user_id)
            .values(**update_values)
        )
    
    return UpdateProfileResponse(
        success=True,
        message="User profile updated successfully"
    )


class UpdateRoleRequest(BaseModel):
    role: Literal["admin", "student"]


@router.put("/{user_id}/role", response_model=UpdateProfileResponse)
def update_user_role(
    user_id: str,
    req: UpdateRoleRequest,
    admin: CurrentUser = Depends(require_admin),
) -> UpdateProfileResponse:
    """Admin-only endpoint to update a user's role (admin/student)."""
    with get_conn() as conn, conn.begin():
        # Verify user exists and belongs to same org
        user_row = conn.execute(
            select(users.c.id, users.c.org_id, users.c.role)
            .where(users.c.id == user_id)
        ).mappings().first()
        
        if not user_row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )
        
        if str(user_row["org_id"]) != admin.org_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot update user from another organization"
            )
        
        # Prevent admin from changing their own role
        if str(user_row["id"]) == admin.user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot change your own role"
            )

        conn.execute(
            update(users)
            .where(users.c.id == user_id)
            .values(role=req.role)
        )
    
    return UpdateProfileResponse(
        success=True,
        message=f"User role updated to {req.role} successfully"
    )


@router.delete("/{user_id}", response_model=DeleteStudentResponse, status_code=status.HTTP_200_OK)
def delete_user(
    user_id: str,
    admin: CurrentUser = Depends(require_admin),
) -> DeleteStudentResponse:
    """Admin-only endpoint to delete a user (soft delete)."""
    with get_conn() as conn, conn.begin():
        user_row = conn.execute(
            select(
                users.c.id,
                users.c.org_id,
                users.c.role,
                users.c.email,
                users.c.deleted_at,
            ).where(users.c.id == user_id)
        ).mappings().first()

        if not user_row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )
        
        if str(user_row["org_id"]) != admin.org_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot delete user from another organization"
            )

        # Prevent admin from deleting themselves
        if str(user_row["id"]) == admin.user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot delete yourself"
            )

        # If deleting an admin, check if this is the last admin
        if str(user_row["role"]) == "admin":
            admin_count = conn.execute(
                select(users.c.id)
                .where(
                    users.c.org_id == admin.org_id,
                    users.c.role == "admin",
                    users.c.deleted_at.is_(None)
                )
            ).rowcount
            
            if admin_count <= 1:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cannot remove the last admin in the organization"
                )

        if user_row["deleted_at"] is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User has already been deleted"
            )

        deleted_timestamp = utcnow_iso()

        result = conn.execute(
            update(users)
            .where(users.c.id == user_id)
            .values(
                deleted_at=deleted_timestamp,
                is_active=False,
            )
        )

        if result.rowcount == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to delete user."
            )

        # Revoke all refresh tokens for this user
        conn.execute(
            update(refresh_tokens)
            .where(
                refresh_tokens.c.user_id == user_id,
                refresh_tokens.c.revoked_at.is_(None),
            )
            .values(revoked_at=deleted_timestamp)
        )

    return DeleteStudentResponse(
        success=True,
        message=f"User {user_row['email']} has been removed successfully",
        student_email=str(user_row["email"]),
    )
